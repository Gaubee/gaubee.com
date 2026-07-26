/**
 * GithubApp 列表页数据缓存（保活）。
 *
 * 问题：RepoListView 不是常驻视图（GithubView 按 pathname 分发到详情页时，
 * RepoListView 组件实例被替换，重新挂载时 onMount 重跑，重新拉取数据）。
 *
 * 方案：把列表数据放模块级 $state 缓存。组件重新挂载时先读缓存立即渲染，
 * 后台异步刷新。刷新去重（inFlight 守卫），避免并发请求。
 *
 * 缓存粒度：聚合首页（myRepos + orgs + orgRepos）+ 分页列表（按 listFilter key）。
 */
import type { RepoSummary, OrgSummary } from "./repo-api";

/** 聚合首页缓存。 */
interface HomeCache {
  myRepos: RepoSummary[];
  /** 我的仓库总数下界（GitHub Link 头推算，>= myRepos.length）。 */
  myReposTotal: number;
  orgs: OrgSummary[];
  orgRepos: Record<string, RepoSummary[]>;
  /** 各 org 仓库总数下界。 */
  orgReposTotal: Record<string, number>;
  /** 加载时间戳（用于判断是否需要刷新）。 */
  loadedAt: number;
}

/** 分页列表缓存（按 listFilter key）。 */
interface FilterCache {
  title: string;
  repos: RepoSummary[];
  /** GitHub 报告的总数（来自 Link 头 last page 推算，或搜索接口的 total_count）。 */
  total: number;
  /** 已加载到的页码。 */
  loadedPage: number;
  /** 是否还有更多页。 */
  hasMore: boolean;
}

class GithubListCache {
  /** 聚合首页缓存（响应式，组件直接读）。 */
  home = $state<HomeCache | null>(null);
  /** 分页列表缓存（按 listFilter key）。 */
  filters = $state<Record<string, FilterCache>>({});

  /** 首页加载去重守卫。 */
  homeInFlight = false;
  /** 分页加载去重守卫（按 listFilter key）。 */
  filterInFlight = new Set<string>();

  /** 缓存有效期（ms），超过则视为过期需刷新。10 分钟。 */
  private readonly TTL = 10 * 60 * 1000;

  /** 首页缓存是否过期/不存在。 */
  homeStale(): boolean {
    if (!this.home) return true;
    return Date.now() - this.home.loadedAt > this.TTL;
  }

  /** 清空首页缓存（登出/手动刷新时）。 */
  clearHome(): void {
    this.home = null;
  }

  /** 清空指定分页缓存。 */
  clearFilter(key: string): void {
    delete this.filters[key];
  }

  /** 清空全部分页缓存。 */
  clearAllFilters(): void {
    this.filters = {};
  }
}

/** 列表缓存单例。 */
export const listCache = new GithubListCache();
