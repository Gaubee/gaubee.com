/**
 * View 注册表：把 TabId / pop 路由 / 深链接模式映射到对应的视图懒加载器。
 *
 * - tab view：main/bottom 区的 tab，常驻 DOM（CSS 切换显示，组件保活）。
 *   组件首次加载是异步的（ViewLoader），AreaOutlet 维护已加载组件缓存以保留保活。
 * - pop view：模态弹层，按需挂载。
 * - deepLink view：main 区的非 tab 路径（如 /article/...、/tags/...），非常驻，
 *   activeTabId 为 null 时按路径匹配渲染。
 *
 * 正交意图：
 * 1. ViewLoader 注册（按 TabId / pop route / deepLink pattern）。
 * 2. 查询：getTabLoader / getPopLoader / getDeepLinkLoader / getAllTabLoaders。
 * 3. 激活判定：activeTabIdForLocation（纯函数，不依赖加载状态）。
 */
import type { ViewLoader } from "$lib/apps/types";
import type { Area, HistoryLocation, TabId } from "$lib/nav/controller";

/**
 * 各类视图的 props 契约（与 AreaOutlet.svelte 的渲染调用对齐）：
 * - tab view：AreaOutlet 总是传入 { area, tabId, isActive }，但多数组件忽略它们
 *   （Svelte 允许传入未声明的 props）。
 * - pop view：无 props。
 * - deep link view：AreaOutlet 总是传入 { pathname }；需要路径的组件（如
 *   ArticleDetailView）应声明并使用它，不需要的（如 AccountView）可忽略。
 *
 * 注意：受 Svelte Component 逆变特性限制，此处不通过类型参数强制约束 props
 * （否则无法同时容纳"声明 pathname"与"不声明任何 props"的组件）。
 * DeepLinkViewProps 仅供文档与消费方参考。
 */
export interface DeepLinkViewProps {
  pathname: string;
}

/** tab view 注册表（按 TabId → 懒加载器）。 */
const tabLoaders = new Map<TabId, ViewLoader>();

/** pop view 注册表（按 POP_ROUTES 前缀 → 懒加载器）。 */
const popLoaders = new Map<string, ViewLoader>();

/** 深链接 view 注册表（按路径前缀 → 懒加载器，按注册顺序匹配）。 */
const deepLinkLoaders: Array<{ pattern: string; loader: ViewLoader }> = [];

export function registerTabView(tabId: TabId, loader: ViewLoader): void {
  tabLoaders.set(tabId, loader);
}

export function registerPopView(route: string, loader: ViewLoader): void {
  popLoaders.set(route, loader);
}

/** 注册深链接 view。pattern 是路径前缀（如 '/article'），匹配 pathname 以此开头。 */
export function registerDeepLinkView(pattern: string, loader: ViewLoader): void {
  deepLinkLoaders.push({ pattern, loader });
}

export function getTabLoader(tabId: TabId): ViewLoader | undefined {
  return tabLoaders.get(tabId);
}

export function getPopLoader(route: string): ViewLoader | undefined {
  if (popLoaders.has(route)) return popLoaders.get(route);
  for (const [prefix, loader] of popLoaders) {
    if (route.startsWith(prefix + "/") || route === prefix) return loader;
  }
  return undefined;
}

/** 按路径查找深链接 loader（第一个匹配的 pattern）。 */
export function getDeepLinkLoader(pathname: string): ViewLoader | undefined {
  for (const { pattern, loader } of deepLinkLoaders) {
    if (pathname === pattern || pathname.startsWith(pattern + "/")) {
      return loader;
    }
  }
  return undefined;
}

/** 所有已注册的 tab view loader（供 AreaOutlet 按需加载 + 缓存保活）。 */
export function getAllTabLoaders(): ReadonlyArray<{
  tabId: TabId;
  loader: ViewLoader;
}> {
  return Array.from(tabLoaders.entries()).map(([tabId, loader]) => ({
    tabId,
    loader,
  }));
}

/**
 * 根据 area 当前 location，判断哪个 tab view 应该激活显示。
 * - main：location.pathname 指向的 tab（用 pathToTabId），或 null（深链接无对应 tab）。
 * - bottom：同上。
 * - pop：返回 null（pop 不用常驻渲染）。
 */
export function activeTabIdForLocation(
  location: HistoryLocation,
  area: Area,
  tabIdsInArea: readonly TabId[],
): TabId | null {
  if (area === "pop") return null;
  const path = location.pathname;
  for (const tabId of tabIdsInArea) {
    if (path === tabId || path.startsWith(tabId + "/")) {
      return tabId;
    }
  }
  return null;
}
