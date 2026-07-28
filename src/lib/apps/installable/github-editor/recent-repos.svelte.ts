/**
 * RecentRepos：GithubEditor 最近打开仓库 store。
 *
 * 2026-07-28：GithubEditorApp 首页底部「历史打开过的 10~20 个仓库」数据源。
 *
 * 设计（仿 repoFavorites）：
 * - 内存 `$state<RecentRepo[]>` 响应式快照，按 openedAt 倒序
 * - 持久化到 meta-store 的 editor_recent_repos store（IndexedDB）
 * - touch(owner, repo)：进入编辑器时调用，更新 openedAt + 移到顶部
 * - MAX_KEEP = 20：超出裁剪最旧的
 */
import { browser } from "$app/environment";
import {
  recentRepoAll,
  recentRepoPut,
  recentRepoDelete,
  type RecentRepo,
} from "$lib/vfs/meta-store";

export type { RecentRepo };

const MAX_KEEP = 20;

class RecentRepos {
  /** 最近仓库列表（响应式，按 openedAt 倒序）。 */
  private _items = $state<RecentRepo[]>([]);
  initialized = $state(false);
  private initInFlight: Promise<void> | null = null;

  get items(): RecentRepo[] {
    return this._items;
  }

  /** 从 meta-store 恢复（幂等，并发合并）。 */
  async init(): Promise<void> {
    if (this.initialized) return;
    if (this.initInFlight) return this.initInFlight;
    this.initInFlight = this.doInit();
    try {
      await this.initInFlight;
    } finally {
      this.initInFlight = null;
    }
  }

  private async doInit(): Promise<void> {
    if (!browser) {
      this.initialized = true;
      return;
    }
    try {
      const all = await recentRepoAll();
      all.sort((a, b) => b.openedAt - a.openedAt);
      this._items = all;
    } catch {
      // meta-store 未就绪，忽略
    } finally {
      this.initialized = true;
    }
  }

  private repoId(owner: string, repo: string): string {
    return `${owner}/${repo}`;
  }

  /**
   * 触碰仓库（进入编辑器时调用）。
   * 已存在则更新 openedAt 移到顶部；不存在则新建并裁剪超出的最旧记录。
   * @param branch 上次打开的分支（可选，方便恢复）
   * @param path 上次打开的文件路径（可选）
   */
  async touch(
    owner: string,
    repo: string,
    opts: { branch?: string; path?: string } = {},
  ): Promise<void> {
    const id = this.repoId(owner, repo);
    const now = Date.now();
    const record: RecentRepo = {
      id,
      owner,
      repo,
      openedAt: now,
      branch: opts.branch,
      path: opts.path,
    };
    // 更新内存（移到顶部）
    this._items = [record, ...this._items.filter((r) => r.id !== id)].slice(0, MAX_KEEP);
    if (browser) {
      try {
        await recentRepoPut(record);
        // 裁剪超出 MAX_KEEP 的旧记录（持久化层）
        if (this._items.length === MAX_KEEP) {
          const all = await recentRepoAll();
          all.sort((a, b) => b.openedAt - a.openedAt);
          const toRemove = all.slice(MAX_KEEP);
          await Promise.all(toRemove.map((r) => recentRepoDelete(r.id)));
        }
      } catch {
        // 持久化失败不影响内存
      }
    }
  }

  /** 移除某条记录。 */
  async remove(owner: string, repo: string): Promise<void> {
    const id = this.repoId(owner, repo);
    this._items = this._items.filter((r) => r.id !== id);
    if (browser) {
      try {
        await recentRepoDelete(id);
      } catch {
        // 忽略
      }
    }
  }
}

/** 最近打开仓库单例。 */
export const recentRepos = new RecentRepos();
