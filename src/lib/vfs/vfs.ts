/**
 * 异步虚拟文件系统（VFS）—— 扁平 IndexedDB + Unix API。
 *
 * 设计目标：
 * - 统一当前 stagedChanges（未提交修改）与 contentCache（远程缓存）为一个抽象。
 * - 提供类 Unix 接口（readFile/writeFile/unlink/readdir/stat），未来 bash 直接挂载。
 * - 三层读取优先级：本地修改（dirty） > 远程缓存（remote） > 在线拉取（fetch）。
 * - fetch 用 Trees API 增量同步（sha 比对），commit 用 Git Data API 批量提交。
 *
 * 不依赖 Svelte runes，纯 TS 类，可被任何代码调用（视图、测试、未来 bash）。
 */
import { browser } from "$app/environment";
import { accountService } from "$lib/apps/builtin/account/service";
import { NoChangesError } from "$lib/os/services";
import { readonlyVfs } from "./readonly";
import {
  vfsAll,
  vfsClear,
  vfsDelete,
  vfsGet,
  vfsPut,
  type VfsRecord,
} from "$lib/db";
import {
  BRANCH,
  OWNER,
  REPO,
  commitChanges,
  fetchTree,
  getFileText,
  type GhTreeEntry,
} from "$lib/github/client";

/** VFS 暴露给视图/未来的 bash 的文件元数据快照。content=null 表示待删除。 */
export interface VfsNode {
  path: string;
  /** 文件内容。null = 待删除标记（unlink 后）。 */
  content: string | null;
  sha: string | null;
  origin: "remote" | "local";
  dirty: boolean;
  mtime: number;
  /** 修改前的原始内容快照（首次 dirty 时保存，用于 diff）。非 dirty 或无快照时为 null。 */
  baseContent: string | null;
}

function toNode(rec: VfsRecord): VfsNode {
  return {
    path: rec.path,
    content: rec.content,
    sha: rec.sha,
    origin: rec.origin,
    dirty: rec.dirty,
    mtime: rec.mtime,
    baseContent: rec.baseContent ?? null,
  };
}

/** 规范化路径：去除前导/后置斜杠，合并重复斜杠。 */
function normalizePath(p: string): string {
  return p.replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
}

/** 简易并发池：限制 Promise 并发数（p-limit 风格，无依赖）。 */
async function pool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const i = cursor++;
        results[i] = await fn(items[i], i);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

export class Vfs {
  /**
   * 读取文件文本内容。三层优先级：
   * 1. IndexedDB 里的 VFS 记录（含本地修改）→ 直接返回 content
   * 2. 只读层（构建时静态数据，无需登录）→ 直接返回，不在线拉取
   * 3. 都没有 → 在线拉取（getFileText），写入 VFS 作为 remote 缓存
   *
   * 这是修复"EditorView 不读暂存"Bug 的关键：本地修改自动优先返回。
   * 只读层 fallback 避免读公开内容时打 GitHub API（被 rate limit / 需登录）。
   */
  async readFile(path: string): Promise<string> {
    const p = normalizePath(path);
    const rec = await vfsGet(p);
    if (rec) {
      if (rec.content === null) throw new Error(`ENOENT: ${p} 已删除`);
      return rec.content;
    }
    // 只读层（构建时静态数据）：公开内容无需登录即可读，不触发 GitHub API
    const readonlyContent = readonlyVfs.readFile(p);
    if (readonlyContent !== null) return readonlyContent;
    // 只读层无此文件（如 draft 或只读层未覆盖），在线拉取
    const content = await getFileText(p);
    await vfsPut({
      path: p,
      content,
      sha: null,
      origin: "remote",
      dirty: false,
      mtime: Date.now(),
    });
    return content;
  }

  /** 写入文件（自动标记 dirty）。新建文件 origin=local。 */
  async writeFile(path: string, content: string): Promise<void> {
    const p = normalizePath(path);
    const existing = await vfsGet(p);
    // 首次 dirty（existing 非 dirty）→ 保存原始内容作为 base 快照（供 diff）。
    // 后续 dirty 不覆盖 base（保留最初原始态）；commit/revert 清除 base。
    const isFirstDirty = !existing || !existing.dirty;
    const baseContent = isFirstDirty
      ? (existing?.content ?? null)
      : (existing?.baseContent ?? null);
    await vfsPut({
      path: p,
      content,
      sha: existing?.sha ?? null,
      origin: existing?.origin ?? "local",
      dirty: true,
      mtime: Date.now(),
      baseContent,
    });
  }

  /** 删除文件（标记为待删除，commit 时真正从远程移除）。保留 sha 供 commit 用。 */
  async unlink(path: string): Promise<void> {
    const p = normalizePath(path);
    const existing = await vfsGet(p);
    if (!existing) return; // 本就不存在，幂等
    // 标记为删除：content=null, dirty=true。保留 sha 以便 commit 时构造 tree 删除项。
    await vfsPut({
      path: p,
      content: null,
      sha: existing.sha,
      origin: existing.origin,
      dirty: true,
      mtime: Date.now(),
    });
  }

  /** 撤销本地修改：恢复到远程状态（删除本地修改记录）。仅对 remote 文件有效。 */
  async revert(path: string): Promise<void> {
    const p = normalizePath(path);
    const rec = await vfsGet(p);
    if (!rec || rec.origin === "local") {
      // 本地新建文件：撤销=删除记录
      await vfsDelete(p);
      return;
    }
    // remote 文件：清 dirty，重新拉取
    const content = await getFileText(p);
    await vfsPut({
      path: p,
      content,
      sha: rec.sha,
      origin: "remote",
      dirty: false,
      mtime: Date.now(),
      baseContent: null,
    });
  }

  /** 获取文件元数据（不触发拉取）。 */
  async stat(path: string): Promise<VfsNode | null> {
    const p = normalizePath(path);
    const rec = await vfsGet(p);
    return rec ? toNode(rec) : null;
  }

  /**
   * 列出 VFS 内某前缀下的文件。
   * @param prefix 目录前缀（如 'src/content/articles'），空字符串=全部
   * @param opts.recursive 递归列出子目录文件（默认 true）
   * 只返回 content !== null（即未删除）的文件。
   */
  async readdir(
    prefix = "",
    opts: { recursive?: boolean } = {},
  ): Promise<VfsNode[]> {
    const recursive = opts.recursive ?? true;
    const all = await vfsAll();
    const p = normalizePath(prefix);
    const prefixWithSlash = p ? `${p}/` : "";
    return all
      .filter((rec) => rec.content !== null)
      .filter((rec) => (p ? rec.path.startsWith(prefixWithSlash) : true))
      .filter((rec) => {
        if (recursive) return true;
        // 非递归：只看直接子项（path 去掉 prefix 后不再含 /）
        const rest = rec.path.slice(prefixWithSlash.length);
        return !rest.includes("/");
      })
      .map(toNode)
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  /** 列出所有 dirty（未提交修改/删除）的文件。 */
  async dirtyFiles(): Promise<VfsNode[]> {
    const all = await vfsAll();
    return all.filter((rec) => rec.dirty).map(toNode);
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

    // 建立当前 VFS 的 path → record 索引
    const existing = await vfsAll();
    const existingMap = new Map(existing.map((r) => [r.path, r]));
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
    // 通过账户服务判断登录态（httpOnly cookie 前端读不到，旧代码读 document.cookie 恒为 false）
    const authed = accountService.isAuthenticated;
    const limit = authed ? 6 : 2;
    await pool(toFetch, limit, async (entry) => {
      try {
        const content = await getFileText(entry.path);
        await vfsPut({
          path: entry.path,
          content,
          sha: entry.sha,
          origin: "remote",
          dirty: false,
          mtime: Date.now(),
        });
      } catch (e) {
        console.warn(`VFS.fetch: 拉取 ${entry.path} 失败`, e);
      }
    });

    // 3. VFS 有但远程已删（且非 dirty 本地新建）→ 标记删除
    for (const rec of existing) {
      if (!remotePaths.has(rec.path) && rec.origin === "remote" && !rec.dirty) {
        await vfsPut({
          ...rec,
          content: null,
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
    // content=string → 新增/修改
    const changes = dirty.map((n) => ({
      path: n.path,
      content: n.content,
      sha: n.sha,
    }));

    const sha = await commitChanges(message, changes, BRANCH);

    // commit 成功：清除 dirty 状态与 base 快照
    for (const node of dirty) {
      const rec = await vfsGet(node.path);
      if (!rec) continue;
      if (rec.content === null) {
        // 删除的文件：从 VFS 移除
        await vfsDelete(node.path);
      } else {
        await vfsPut({
          ...rec,
          dirty: false,
          mtime: Date.now(),
          baseContent: null,
        });
      }
    }
    return sha;
  }

  /** 清空整个 VFS（调试/重置用）。 */
  async clear(): Promise<void> {
    await vfsClear();
  }
}

/** 单例。 */
export const vfs = new Vfs();

// 导出仓库信息（视图/未来 bash 需要）
export { OWNER, REPO, BRANCH };
