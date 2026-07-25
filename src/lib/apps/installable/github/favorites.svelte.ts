/**
 * RepoFavorites：GithubApp 仓库收藏 store。
 *
 * 设计：
 * - 内存 `$state<RepoFavorite[]>` 提供响应式快照（列表页首页聚合卡片直接消费）。
 * - 持久化到 meta-store 的 `repo_favorites` store（IndexedDB），刷新后恢复。
 * - 只存 owner/repo 身份标识，元数据（star/description 等）渲染时实时从 GitHub 拉。
 *
 * 与 activityLog 同层（纯单例 store，不经 bus），由 GithubView 直接 import。
 */
import { browser } from "$app/environment";
import { favoriteAll, favoriteDelete, favoritePut, type RepoFavorite } from "$lib/vfs/meta-store";

export type { RepoFavorite };

class RepoFavorites {
  /** 收藏列表（响应式，按收藏时间倒序）。 */
  private _items = $state<RepoFavorite[]>([]);
  /** 是否已初始化。 */
  initialized = $state(false);
  private initInFlight: Promise<void> | null = null;

  get items(): RepoFavorite[] {
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
      const all = await favoriteAll();
      all.sort((a, b) => b.favoritedAt - a.favoritedAt);
      this._items = all;
    } catch {
      // meta-store 未就绪，忽略
    } finally {
      this.initialized = true;
    }
  }

  /** 仓库标识（owner/repo）。 */
  private repoId(owner: string, repo: string): string {
    return `${owner}/${repo}`;
  }

  /** 是否已收藏。 */
  has(owner: string, repo: string): boolean {
    const id = this.repoId(owner, repo);
    return this._items.some((f) => f.id === id);
  }

  /** 收藏仓库（已存在则忽略）。 */
  async add(owner: string, repo: string): Promise<void> {
    const id = this.repoId(owner, repo);
    if (this._items.some((f) => f.id === id)) return;
    const fav: RepoFavorite = { id, owner, repo, favoritedAt: Date.now() };
    this._items = [fav, ...this._items];
    if (browser) {
      try {
        await favoritePut(fav);
      } catch {
        // 持久化失败不影响内存
      }
    }
  }

  /** 取消收藏。 */
  async remove(owner: string, repo: string): Promise<void> {
    const id = this.repoId(owner, repo);
    this._items = this._items.filter((f) => f.id !== id);
    if (browser) {
      try {
        await favoriteDelete(id);
      } catch {
        // 忽略
      }
    }
  }

  /** 切换收藏状态。 */
  async toggle(owner: string, repo: string): Promise<void> {
    if (this.has(owner, repo)) {
      await this.remove(owner, repo);
    } else {
      await this.add(owner, repo);
    }
  }
}

/** 仓库收藏单例。 */
export const repoFavorites = new RepoFavorites();
