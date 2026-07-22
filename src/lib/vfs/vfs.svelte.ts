/**
 * VFS 的 Svelte 5 runes 适配层。
 *
 * 视图组件订阅 vfsStore，VFS 内部变更后调用 store 的 refresh() 更新响应式 files 数组。
 * vfsStore.current 是 reactive 快照，模板里直接用。
 */
import { browser } from "$app/environment";
import { vfs, type VfsNode } from "./vfs";

// re-export 供视图使用
export { vfs, type VfsNode };
export { OWNER, REPO, BRANCH } from "./vfs";

class VfsStore {
  /** VFS 内所有文件（reactive，按 path 排序）。 */
  files = $state<VfsNode[]>([]);
  /** 是否已加载（首次 fetch 完成）。 */
  loaded = $state(false);
  /** 是否正在加载/同步。 */
  loading = $state(false);
  /** 最近一次错误。 */
  error = $state<string | null>(null);
  /** dirty 文件数（reactive，commit 前预览）。 */
  dirtyCount = $state(0);

  private inFlight: Promise<void> | null = null;
  /** commit 互斥锁：并发 commit 合并为同一 Promise，避免重复提交（竞态）。 */
  private commitInFlight: Promise<string> | null = null;

  /**
   * 从 GitHub 同步（fetch）。幂等，并发合并。
   * @param subtree 子树前缀，默认 'src/content'（只拉内容，不拉整个仓库）
   */
  async sync(subtree = "src/content"): Promise<void> {
    if (!browser) return;
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.doSync(subtree);
    try {
      await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  private async doSync(subtree: string): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      await vfs.fetch(subtree);
      await this.refresh();
      this.loaded = true;
    } catch (e) {
      this.error = e instanceof Error ? e.message : "VFS 同步失败";
    } finally {
      this.loading = false;
    }
  }

  /** 刷新响应式快照（从 IndexedDB 重读）。VFS 写操作后调用。 */
  async refresh(): Promise<void> {
    const [all, dirty] = await Promise.all([
      vfs.readdir("", { recursive: true }),
      vfs.dirtyFiles(),
    ]);
    this.files = all;
    this.dirtyCount = dirty.length;
  }

  // ---- 便捷代理（视图常用，写后自动 refresh）----

  async read(path: string): Promise<string> {
    return vfs.readFile(path);
  }

  async write(path: string, content: string): Promise<void> {
    await vfs.writeFile(path, content);
    await this.refresh();
  }

  async unlink(path: string): Promise<void> {
    await vfs.unlink(path);
    await this.refresh();
  }

  async revert(path: string): Promise<void> {
    await vfs.revert(path);
    await this.refresh();
  }

  /**
   * 提交所有 dirty 变更到 GitHub。
   * 并发合并：连点提交按钮时，第二次调用复用第一次的 Promise（同一批变更只提交一次）。
   */
  async commit(message: string): Promise<string> {
    if (this.commitInFlight) return this.commitInFlight;
    this.commitInFlight = this.doCommit(message);
    try {
      return await this.commitInFlight;
    } finally {
      this.commitInFlight = null;
    }
  }

  private async doCommit(message: string): Promise<string> {
    const sha = await vfs.commit(message);
    await this.refresh();
    // commit 后重新同步（更新 sha）
    this.sync();
    return sha;
  }

  /** 按 collection 筛选文件。 */
  filesInCollection(collection: "articles" | "events"): VfsNode[] {
    return this.files.filter((f) =>
      f.path.startsWith(`src/content/${collection}/`),
    );
  }
}

export const vfsStore = new VfsStore();
