import { getBranch } from "$lib/apps/installable/github/repo-api";
import { fetchTree, getFileText, commitChanges, type StagedChange } from "$lib/github/client";
import { diffLines } from "$lib/utils/diff";
/**
 * EditorVfs：GithubEditor 的双文件夹 VFS（runes 响应式）。
 *
 * 2026-07-28：为 GithubEditorApp 设计，绕过旧 Vfs 的单仓库硬编码限制。
 *
 * 双文件夹模型：
 * - local 层：用户编辑的未提交文件（editor_local_meta store，IndexedDB 持久化）
 * - remote 层：目标分支的最新文件缓存（editor_remote_cache store，含 fileTree-json）
 *
 * 数据流：
 * ```
 * loadRemote(branch) → getBranch(HEAD sha) → fetchTree(完整 blobs) → 缓存
 * readLocal(path)    → local 有则返回 local，否则按 remote sha 读 remote
 * writeLocal(path)   → 写 local（标 dirty）
 * diff()             → local files vs remote blobs 算文件级 diff（add/mod/del）
 * fileContentDiff()  → local content vs remote content 行级 diff
 * commit()           → 收集 dirty → commitChanges({owner, repo, branch})
 * ```
 *
 * 缓存策略：remote 按 commit-hash 隔离（刷新时比对 HEAD sha，不一致则重拉）。
 */
import {
  editorLocalAll,
  editorLocalPut,
  editorLocalDelete,
  editorLocalClear,
  editorRemoteGet,
  editorRemotePut,
  type EditorFileMeta,
  type EditorRemoteCache,
} from "$lib/vfs/meta-store";

/** 文件级 diff 条目。 */
export interface FileDiff {
  path: string;
  /** add=本地新增，mod=本地修改，del=本地删除。 */
  kind: "add" | "mod" | "del";
}

/** 单文件行级 diff 结果。 */
export interface ContentDiff {
  /** 远程原始内容（del/add 时可能为 null）。 */
  base: string | null;
  /** 本地当前内容（del 时为 null）。 */
  current: string | null;
}

/**
 * 创建一个仓库的 EditorVfs 实例。
 * 每个仓库独立实例，内部状态为 runes $state（响应式）。
 */
export function createEditorVfs(owner: string, repo: string) {
  // ---- local 层：内存响应式 + IndexedDB 持久化 ----
  let localFiles = $state<EditorFileMeta[]>([]);
  let localLoaded = $state(false);

  // ---- remote 层：缓存（commit-hash 隔离）----
  let remoteCache = $state<EditorRemoteCache | null>(null);
  let remoteLoading = $state(false);
  let remoteError = $state<string | null>(null);
  /** 当前 remote 缓存对应的分支 HEAD sha（用于刷新检测）。 */
  let remoteCommitSha = $state<string | null>(null);

  // ---- 加载状态 ----
  let loading = $state(false);

  /** 加载本地层（从 IndexedDB 恢复）。 */
  async function loadLocal(): Promise<void> {
    localFiles = await editorLocalAll(owner, repo);
    localLoaded = true;
  }

  /**
   * 加载/刷新 remote 层。
   * @param branch 目标分支名
   * @param force 强制刷新（忽略 commit-hash 缓存）
   * 流程：getBranch(HEAD sha) → 比对缓存 → fetchTree(完整 blobs) → 持久化
   */
  async function loadRemote(branch: string, force = false): Promise<void> {
    remoteLoading = true;
    remoteError = null;
    try {
      // 1. 查分支 HEAD commit sha
      const branchInfo = await getBranch(owner, repo, branch);
      if (!branchInfo) {
        throw new Error(`分支 ${branch} 不存在`);
      }
      const headSha = branchInfo.commit.sha;

      // 2. 缓存命中检测（非 force 且 sha 一致 → 跳过）
      if (!force && remoteCache && remoteCache.commitSha === headSha) {
        remoteCommitSha = headSha;
        return;
      }

      // 3. 查 IndexedDB 缓存（commit-hash 隔离）
      const cached = await editorRemoteGet(owner, repo, headSha);
      if (cached && !force) {
        remoteCache = cached;
        remoteCommitSha = headSha;
        return;
      }

      // 4. fetchTree 拉取完整 blobs 清单（一次请求）
      const { tree, sha: treeSha } = await fetchTree(undefined, {
        owner,
        repo,
        ref: headSha,
      });
      const blobs = tree
        .filter((e) => e.type === "blob")
        .map((e) => ({ path: e.path, sha: e.sha, mode: e.mode, type: e.type }));

      // 5. 持久化 + 更新内存
      const cache: EditorRemoteCache = {
        id: `${owner}/${repo}@${headSha}`,
        owner,
        repo,
        commitSha: headSha,
        branch,
        blobs,
        cachedAt: Date.now(),
      };
      await editorRemotePut(cache);
      remoteCache = cache;
      remoteCommitSha = headSha;
    } catch (e) {
      remoteError = e instanceof Error ? e.message : "加载远程文件失败";
    } finally {
      remoteLoading = false;
    }
  }

  /** 读文件：local 优先（含 dirty 修改），否则读 remote（按 commit sha）。 */
  async function readFile(path: string): Promise<string> {
    // local 层（未删除的）
    const local = localFiles.find((f) => f.path === path && !f.deleted);
    if (local) return local.content;
    // remote 层（按缓存的 commit sha 读）
    if (remoteCommitSha) {
      return getFileText(path, { owner, repo, ref: remoteCommitSha });
    }
    return getFileText(path, { owner, repo });
  }

  /** 写 local 层（标 dirty）。若文件不存在则新建（sha=null）。
   *  @param opts.encoding 'base64' 时 content 为纯 base64 字符串（二进制文件） */
  async function writeLocal(
    path: string,
    content: string,
    opts: { encoding?: "utf-8" | "base64" } = {},
  ): Promise<void> {
    const id = `${owner}/${repo}/${path}`;
    const existing = localFiles.find((f) => f.path === path);
    // remote 原始 sha（首次写入时捕获，用于 diff + 提交乐观锁）
    const remoteSha = existing?.sha ?? remoteCache?.blobs.find((b) => b.path === path)?.sha ?? null;
    const meta: EditorFileMeta = {
      id,
      owner,
      repo,
      path,
      sha: remoteSha,
      content,
      encoding: opts.encoding,
      deleted: false,
      mtime: Date.now(),
    };
    await editorLocalPut(meta);
    // 更新内存（替换或追加）
    const idx = localFiles.findIndex((f) => f.path === path);
    if (idx >= 0) {
      localFiles[idx] = meta;
    } else {
      localFiles = [...localFiles, meta];
    }
  }

  /** 标记删除（软删除，保留 sha 供提交）。仅对 remote 存在的文件有效。 */
  async function deleteLocal(path: string): Promise<void> {
    const remoteBlob = remoteCache?.blobs.find((b) => b.path === path);
    if (!remoteBlob) {
      // remote 不存在 → 本地新建文件直接移除
      await editorLocalDelete(owner, repo, path);
      localFiles = localFiles.filter((f) => f.path !== path);
      return;
    }
    // 软删除：保留 sha，标记 deleted
    const id = `${owner}/${repo}/${path}`;
    const meta: EditorFileMeta = {
      id,
      owner,
      repo,
      path,
      sha: remoteBlob.sha,
      content: "",
      deleted: true,
      mtime: Date.now(),
    };
    await editorLocalPut(meta);
    const idx = localFiles.findIndex((f) => f.path === path);
    if (idx >= 0) {
      localFiles[idx] = meta;
    } else {
      localFiles = [...localFiles, meta];
    }
  }

  /** 撤销本地修改（删除 local 元数据，回到 remote 状态）。 */
  async function revertLocal(path: string): Promise<void> {
    await editorLocalDelete(owner, repo, path);
    localFiles = localFiles.filter((f) => f.path !== path);
  }

  /**
   * 重命名/移动文件：读旧内容 → 写新路径（保留 encoding）→ 删旧路径。
   * 用于文件树的重命名和拖拽移动。
   * @returns 新路径（成功）或 null（旧路径不存在 / 新路径已存在冲突）
   */
  async function renameLocal(oldPath: string, newPath: string): Promise<string | null> {
    if (oldPath === newPath) return newPath;
    if (await exists(newPath)) return null;
    // 读旧内容（local 优先，否则 remote）
    const local = localFiles.find((f) => f.path === oldPath);
    let content: string;
    let encoding: "utf-8" | "base64" | undefined;
    if (local && !local.deleted) {
      content = local.content;
      encoding = local.encoding;
    } else {
      content = await readFile(oldPath);
      // remote 读出的文本文件 encoding 留空（默认 utf-8）
    }
    await writeLocal(newPath, content, { encoding });
    // 旧路径：local 新建的文件直接删；remote 有的软删除
    const oldInRemote = remoteCache?.blobs.some((b) => b.path === oldPath);
    if (oldInRemote) {
      await deleteLocal(oldPath);
    } else {
      await editorLocalDelete(owner, repo, oldPath);
      localFiles = localFiles.filter((f) => f.path !== oldPath);
    }
    return newPath;
  }

  /**
   * 检查路径是否已存在（local 未删除 或 remote 有）。
   * 用于重命名/粘贴/上传时的冲突检测。
   */
  async function exists(path: string): Promise<boolean> {
    const inLocal = localFiles.some((f) => f.path === path && !f.deleted);
    if (inLocal) return true;
    return remoteCache?.blobs.some((b) => b.path === path) ?? false;
  }

  /**
   * 文件级 diff：local files vs remote blobs。
   * - local 有 + remote 无 → add
   * - local 有 + remote 有 + 内容不同 → mod
   * - local 标记 deleted → del
   */
  const diff = $derived.by<FileDiff[]>(() => {
    const result: FileDiff[] = [];
    const remotePaths = new Map((remoteCache?.blobs ?? []).map((b) => [b.path, b.sha]));

    for (const f of localFiles) {
      if (f.deleted) {
        // 仅当 remote 存在时才算 del（remote 不存在的本地新建文件被删除 = 无变化）
        if (remotePaths.has(f.path)) {
          result.push({ path: f.path, kind: "del" });
        }
      } else if (!remotePaths.has(f.path)) {
        result.push({ path: f.path, kind: "add" });
      } else {
        // remote 存在：内容不同才算 mod（sha 比对不够，因为本地编辑后 sha 不变；
        // 这里用「有 local 元数据」即视为 mod，因为只有被编辑过的文件才会进 local 层）
        result.push({ path: f.path, kind: "mod" });
      }
    }
    return result;
  });

  /** dirty 文件数（diff 条目数）。 */
  const dirtyCount = $derived(diff.length);

  /**
   * 单文件行级 diff：local content vs remote content。
   * @returns {base, current} 供 diffLines 计算
   */
  async function fileContentDiff(path: string): Promise<ContentDiff> {
    const local = localFiles.find((f) => f.path === path);
    if (local?.deleted) {
      return { base: await readRemote(path), current: null };
    }
    if (local && !local.deleted) {
      return { base: await readRemote(path), current: local.content };
    }
    return { base: await readRemote(path), current: await readRemote(path) };
  }

  /** 读 remote 内容（按缓存 commit sha）。 */
  async function readRemote(path: string): Promise<string | null> {
    if (!remoteCache?.blobs.find((b) => b.path === path)) return null;
    try {
      if (remoteCommitSha) {
        return getFileText(path, { owner, repo, ref: remoteCommitSha });
      }
      return getFileText(path, { owner, repo });
    } catch {
      return null;
    }
  }

  /**
   * 提交所有 dirty 文件到 GitHub。
   * @returns 新 commit sha
   */
  async function commit(message: string, branch: string): Promise<string> {
    const changes: StagedChange[] = diff.map((d) => {
      if (d.kind === "del") {
        return { path: d.path, content: null };
      }
      const local = localFiles.find((f) => f.path === d.path);
      return {
        path: d.path,
        content: local?.content ?? "",
        encoding: local?.encoding,
      };
    });
    if (changes.length === 0) {
      throw new Error("没有可提交的变更");
    }
    const sha = await commitChanges(message, changes, { owner, repo, branch });
    // 提交成功：清空 local 层（所有 dirty 已落盘）
    await editorLocalClear(owner, repo);
    localFiles = [];
    return sha;
  }

  return {
    // 状态（响应式 getter）
    get localFiles() {
      return localFiles;
    },
    get localLoaded() {
      return localLoaded;
    },
    get remoteCache() {
      return remoteCache;
    },
    get remoteLoading() {
      return remoteLoading;
    },
    get remoteError() {
      return remoteError;
    },
    get remoteCommitSha() {
      return remoteCommitSha;
    },
    get diff() {
      return diff;
    },
    get dirtyCount() {
      return dirtyCount;
    },
    get loading() {
      return loading;
    },
    // API
    loadLocal,
    loadRemote,
    readFile,
    writeLocal,
    deleteLocal,
    revertLocal,
    renameLocal,
    exists,
    fileContentDiff,
    commit,
  };
}

export type EditorVfs = ReturnType<typeof createEditorVfs>;
