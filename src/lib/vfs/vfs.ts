/**
 * 异步虚拟文件系统（VFS）—— ZenFS + sidecar 元数据 + Unix API。
 *
 * 设计目标：
 * - 统一当前 stagedChanges（未提交修改）与 contentCache（远程缓存）为一个抽象。
 * - 提供类 Unix 接口（readFile/writeFile/unlink/readdir/stat），未来 bash 直接挂载。
 * - 三层读取优先级：本地修改（dirty） > 远程缓存（remote） > 在线拉取（fetch）。
 * - fetch 用 Trees API 增量同步（sha 比对），commit 用 Git Data API 批量提交。
 *
 * 存储分层：
 * - 文件内容（Uint8Array/string）→ ZenFS（IndexedDB 持久化），挂在 /workspace 下。
 * - 业务元数据（dirty/sha/origin/baseContent/mtime/deleted）→ meta-store（idb sidecar）。
 * - 领域语义（dirty 跟踪、sha 比对、baseContent 快照、软删除、commit）完整保留。
 *
 * 不依赖 Svelte runes，纯 TS 类，可被任何代码调用（视图、测试、未来 bash）。
 */
import { browser } from "$app/environment";
import { accountService } from "$lib/apps/builtin/account/service";
import { getFs, type ZenFs } from "$lib/fs/zenfs-instance";
import {
  BRANCH,
  OWNER,
  REPO,
  commitChanges,
  fetchTree,
  getFileText,
  type GhTreeEntry,
} from "$lib/github/client";
import { NoChangesError } from "$lib/os/services";
import {
  metaAll,
  metaClear,
  metaDelete,
  metaGet,
  metaPut,
  type FileMeta,
} from "$lib/vfs/meta-store";

import { readonlyVfs } from "./readonly";

/** VFS 暴露给视图/未来的 bash 的文件元数据快照。content=null 表示待删除。 */
export interface VfsNode {
  path: string;
  /** 文件内容（UTF-8 文本）。null = 待删除标记（unlink 后）。 */
  content: string | null;
  sha: string | null;
  origin: "remote" | "local";
  dirty: boolean;
  mtime: number;
  /** 修改前的原始内容快照（首次 dirty 时保存，用于 diff）。非 dirty 或无快照时为 null。 */
  baseContent: string | null;
}

/** ZenFS 内主工作区根（避免与 /git 撞库）。 */
const WORKSPACE_ROOT = "/workspace";

/** 规范化路径：去除前导/后置斜杠，合并重复斜杠。 */
function normalizePath(p: string): string {
  return p.replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
}

/** 把仓库相对路径转成 ZenFS 绝对路径（/workspace/<path>）。 */
function toZenPath(p: string): string {
  const n = normalizePath(p);
  return n ? `${WORKSPACE_ROOT}/${n}` : WORKSPACE_ROOT;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: false });

function toBytes(data: string | Uint8Array): Uint8Array {
  return typeof data === "string" ? encoder.encode(data) : data;
}

function bytesToString(data: Uint8Array): string {
  return decoder.decode(data);
}

/** 简易并发池：限制 Promise 并发数（p-limit 风格，无依赖）。 */
async function pool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/** 递归删除 ZenFS 目录（容错：不存在时静默）。 */
async function rmrf(fs: ZenFs, absPath: string): Promise<void> {
  try {
    await fs.promises.rm(absPath, { recursive: true, force: true });
  } catch {
    // 不存在或其它错误，忽略
  }
}

/** 确保 ZenFS 工作区目录存在。 */
async function ensureWorkspace(fs: ZenFs): Promise<void> {
  await fs.promises.mkdir(WORKSPACE_ROOT, { recursive: true });
}

export class Vfs {
  /** ZenFS fs 句柄（懒加载）。 */
  private fsPromise: Promise<ZenFs> | null = null;

  /** 获取（懒加载）已初始化的 ZenFS。允许测试注入（mock）。 */
  private async fs(): Promise<ZenFs> {
    if (!this.fsPromise) {
      this.fsPromise = (async () => {
        const fs = await getFs();
        await ensureWorkspace(fs);
        return fs;
      })();
    }
    return this.fsPromise;
  }

  /**
   * 读取文件文本内容。三层优先级：
   * 1. ZenFS + sidecar 元数据（含本地修改）→ 直接返回 content
   * 2. 只读层（构建时静态数据，无需登录）→ 直接返回，不在线拉取
   * 3. 都没有 → 在线拉取（getFileText），写入 ZenFS + sidecar 作为 remote 缓存
   *
   * 这是修复"EditorView 不读暂存"Bug 的关键：本地修改自动优先返回。
   * 只读层 fallback 避免读公开内容时打 GitHub API（被 rate limit / 需登录）。
   */
  async readFile(path: string): Promise<string> {
    const bytes = await this.readFileBytes(path);
    return bytesToString(bytes);
  }

  /** 读取文件原始字节（二进制安全）。三层优先级同 readFile。 */
  async readFileBytes(path: string): Promise<Uint8Array> {
    const p = normalizePath(path);
    const meta = await metaGet(p);
    if (meta) {
      if (meta.deleted) throw new Error(`ENOENT: ${p} 已删除`);
      const fs = await this.fs();
      return fs.promises.readFile(toZenPath(p));
    }
    // 只读层（构建时静态数据）：公开内容无需登录即可读，不触发 GitHub API
    const readonlyContent = readonlyVfs.readFile(p);
    if (readonlyContent !== null) return toBytes(readonlyContent);
    // 只读层无此文件（如 draft 或只读层未覆盖），在线拉取
    const content = await getFileText(p);
    await this.putRemoteCache(p, content, null);
    return toBytes(content);
  }

  /** 写入文件（自动标记 dirty）。新建文件 origin=local。支持 string | Uint8Array。 */
  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    const p = normalizePath(path);
    const existing = await metaGet(p);
    // 首次 dirty（existing 非 dirty 或不存在）→ 保存原始内容作为 base 快照（供 diff）。
    // 后续 dirty 不覆盖 base（保留最初原始态）；commit/revert 清除 base。
    // 注：base 仅对 string 内容有意义（用于 diff/markdown）；二进制写入跳过 base 快照。
    const isFirstDirty = !existing || !existing.dirty || existing.deleted;
    let baseContent: string | null;
    if (isFirstDirty && typeof content === "string") {
      const prev = existing && !existing.deleted ? await this.loadContentOptional(p) : null;
      baseContent = typeof prev === "string" ? prev : null;
    } else {
      baseContent = typeof existing?.baseContent === "string" ? existing.baseContent : null;
    }

    const fs = await this.fs();
    // 先确保父目录存在（ZenFS 不会自动建目录）
    await fs.promises.mkdir(dirname(toZenPath(p)), { recursive: true });
    await fs.promises.writeFile(toZenPath(p), toBytes(content));

    await metaPut({
      path: p,
      sha: existing?.sha ?? null,
      origin: existing?.origin ?? "local",
      dirty: true,
      mtime: Date.now(),
      baseContent,
      deleted: false,
    });
  }

  /** 删除文件（标记为待删除，commit 时真正从远程移除）。保留 sha 供 commit 用。 */
  async unlink(path: string): Promise<void> {
    const p = normalizePath(path);
    const existing = await metaGet(p);
    if (!existing) return; // 本就不存在，幂等
    // 从 ZenFS 物理删除，元数据保留 + 标 deleted，保留 sha 以便 commit 时构造 tree 删除项
    const fs = await this.fs();
    await rmrf(fs, toZenPath(p));
    await metaPut({
      path: p,
      sha: existing.sha,
      origin: existing.origin,
      dirty: true,
      mtime: Date.now(),
      baseContent: existing.baseContent ?? null,
      deleted: true,
    });
  }

  /** 撤销本地修改：恢复到远程状态（删除本地修改记录）。仅对 remote 文件有效。 */
  async revert(path: string): Promise<void> {
    const p = normalizePath(path);
    const rec = await metaGet(p);
    if (!rec || rec.origin === "local") {
      // 本地新建文件：撤销=删除记录 + 物理文件
      const fs = await this.fs();
      await rmrf(fs, toZenPath(p));
      await metaDelete(p);
      return;
    }
    // remote 文件：清 dirty，重新拉取覆盖内容
    const content = await getFileText(p);
    const fs = await this.fs();
    await fs.promises.mkdir(dirname(toZenPath(p)), { recursive: true });
    await fs.promises.writeFile(toZenPath(p), toBytes(content));
    await metaPut({
      path: p,
      sha: rec.sha,
      origin: "remote",
      dirty: false,
      mtime: Date.now(),
      baseContent: null,
      deleted: false,
    });
  }

  /** 获取文件元数据（不触发拉取）。返回 VfsNode（含内容快照）。 */
  async stat(path: string): Promise<VfsNode | null> {
    const p = normalizePath(path);
    const meta = await metaGet(p);
    if (!meta) return null;
    return this.toNode(meta);
  }

  /**
   * 列出 VFS 内某前缀下的文件。
   * @param prefix 目录前缀（如 'src/content/articles'），空字符串=全部
   * @param opts.recursive 递归列出子目录文件（默认 true）
   * 只返回未删除（deleted=false）的文件。content 字段并发从 ZenFS 读出。
   */
  async readdir(prefix = "", opts: { recursive?: boolean } = {}): Promise<VfsNode[]> {
    const recursive = opts.recursive ?? true;
    const all = await metaAll();
    const p = normalizePath(prefix);
    const prefixWithSlash = p ? `${p}/` : "";
    const matched = all
      .filter((m) => !m.deleted)
      .filter((m) => (p ? m.path.startsWith(prefixWithSlash) : true))
      .filter((m) => {
        if (recursive) return true;
        // 非递归：只看直接子项（path 去掉 prefix 后不再含 /）
        const rest = m.path.slice(prefixWithSlash.length);
        return !rest.includes("/");
      })
      .sort((a, b) => a.path.localeCompare(b.path));
    return Promise.all(matched.map((m) => this.toNode(m)));
  }

  /** 列出所有 dirty（未提交修改/删除）的文件。content 字段并发从 ZenFS 读出。 */
  async dirtyFiles(): Promise<VfsNode[]> {
    const all = await metaAll();
    return Promise.all(all.filter((m) => m.dirty).map((m) => this.toNode(m)));
  }

  /**
   * 从 GitHub 同步（fetch）：用 Trees API 一次拉取文件清单，
   * 增量更新 VFS（sha 变化的才重拉内容）。不覆盖本地 dirty 修改。
   * @param subtree 子树前缀（如 'src/content'），默认整个仓库
   */
  async fetch(subtree?: string): Promise<void> {
    if (!browser) return;
    const { tree } = await fetchTree(subtree);
    const blobEntries = tree.filter((e) => e.type === "blob");

    // 建立当前 VFS 的 path → meta 索引
    const existing = await metaAll();
    const existingMap = new Map(existing.map((m) => [m.path, m]));
    const remotePaths = new Set(blobEntries.map((e) => e.path));

    // 1. 远程有但 VFS 无，或 sha 变化 → 需要拉内容
    const toFetch: GhTreeEntry[] = [];
    for (const entry of blobEntries) {
      const rec = existingMap.get(entry.path);
      if (!rec || (!rec.dirty && rec.sha !== entry.sha)) {
        toFetch.push(entry);
      }
    }

    // 2. 并发拉取内容（已登录 5000/h，并发 6 安全；未登录 60/h，并发 2）
    const authed = accountService.isAuthenticated;
    const limit = authed ? 6 : 2;
    await pool(toFetch, limit, async (entry) => {
      try {
        const content = await getFileText(entry.path);
        await this.putRemoteCache(entry.path, content, entry.sha);
      } catch (e) {
        console.warn(`VFS.fetch: 拉取 ${entry.path} 失败`, e);
      }
    });

    // 3. VFS 有但远程已删（且非 dirty 本地新建）→ 标记删除
    for (const rec of existing) {
      if (!remotePaths.has(rec.path) && rec.origin === "remote" && !rec.dirty) {
        const fs = await this.fs();
        await rmrf(fs, toZenPath(rec.path));
        await metaPut({
          ...rec,
          deleted: true,
          dirty: false, // 远程已删，非本地修改，不进 dirty
          mtime: Date.now(),
        });
      }
    }
  }

  /**
   * 提交（commit）：把所有 dirty 文件批量提交到 GitHub。
   * 成功后：dirty 标记清除，被删除文件从 VFS 移除。返回新 commit sha。
   */
  async commit(message: string): Promise<string> {
    const dirty = await this.dirtyFiles();
    if (dirty.length === 0) {
      throw new NoChangesError();
    }
    // content=null（unlink 标记）→ StagedChange.content=null（删除）
    // content=string → 新增/修改（二进制暂不支持 commit，需要时再扩展）
    const changes = dirty.map((n) => ({
      path: n.path,
      content: n.content,
      sha: n.sha,
    }));

    const sha = await commitChanges(message, changes, { branch: BRANCH });

    // commit 成功：清除 dirty 状态与 base 快照
    for (const node of dirty) {
      const rec = await metaGet(node.path);
      if (!rec) continue;
      if (rec.deleted) {
        // 删除的文件：从 VFS 移除
        await metaDelete(node.path);
      } else {
        await metaPut({
          ...rec,
          dirty: false,
          mtime: Date.now(),
          baseContent: null,
        });
      }
    }
    return sha;
  }

  /** 清空整个 VFS（调试/重置用）：ZenFS 工作区 + 元数据。 */
  async clear(): Promise<void> {
    const fs = await this.fs();
    await rmrf(fs, WORKSPACE_ROOT);
    await ensureWorkspace(fs);
    await metaClear();
  }

  /**
   * 重置内部 fs 句柄缓存（仅测试用）。
   * 配合 _resetZenFsForTest / 新的 ZenFS 配置，使下次 fs() 重新初始化。
   */
  _resetFsForTest(): void {
    this.fsPromise = null;
  }

  // ---- 内部辅助 ----

  /** 把远程拉取的内容写入 ZenFS + sidecar（remote 缓存，非 dirty）。 */
  private async putRemoteCache(p: string, content: string, sha: string | null): Promise<void> {
    const fs = await this.fs();
    await fs.promises.mkdir(dirname(toZenPath(p)), { recursive: true });
    await fs.promises.writeFile(toZenPath(p), toBytes(content));
    await metaPut({
      path: p,
      sha,
      origin: "remote",
      dirty: false,
      mtime: Date.now(),
      baseContent: null,
      deleted: false,
    });
  }

  /** 读 ZenFS 里的内容并解码为 UTF-8 文本（meta 已存在且未删除时）。失败返回 null。 */
  private async loadContentOptional(p: string): Promise<string | null> {
    try {
      const fs = await this.fs();
      const bytes = await fs.promises.readFile(toZenPath(p));
      return bytesToString(bytes);
    } catch {
      return null;
    }
  }

  /** meta → VfsNode（按需读取内容；deleted 返回 content=null）。 */
  private async toNode(meta: FileMeta): Promise<VfsNode> {
    return {
      path: meta.path,
      content: meta.deleted ? null : await this.loadContentOptional(meta.path),
      sha: meta.sha,
      origin: meta.origin,
      dirty: meta.dirty,
      mtime: meta.mtime,
      baseContent: typeof meta.baseContent === "string" ? meta.baseContent : null,
    };
  }
}

/** 取路径的父目录（ZenFS 绝对路径）。 */
function dirname(absPath: string): string {
  const idx = absPath.lastIndexOf("/");
  if (idx <= 0) return "/";
  return absPath.slice(0, idx);
}

/** 单例。 */
export const vfs = new Vfs();

// 导出仓库信息（视图/未来 bash 需要）
export { OWNER, REPO, BRANCH };
