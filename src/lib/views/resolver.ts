import { routeDomainRegistry } from "$lib/apps/route-domain";
import type { ViewLoader } from "$lib/apps/types";
/**
 * 统一视图解析器（URL-first）。
 *
 * 纯 URL 驱动：给定 pathname，决定 main 区应该渲染什么视图。
 * 不依赖 mainTabs（任务栏内存状态），只看路由域表 + view 注册表。
 *
 * 解决「任务栏决定渲染」与「URL 是一等公民」的冲突：
 * - 直接访问/刷新任何已注册路径都能正确渲染（无需先 openApp）。
 * - tabView（路由域命中）与 deepLinkView（前缀匹配命中）统一在此决策。
 * - 都未命中 → not-found（由方向二 NotFound 中间件处理）。
 *
 * 替代 registry.ts 的 activeTabIdForLocation（后者依赖 tabIdsInArea 参数）。
 */
import type { TabId } from "$lib/nav/controller";

import { getTabLoader, getDeepLinkLoader } from "./registry";

/** main 区视图解析结果。 */
export type ViewResolution =
  | { kind: "tab"; tabId: TabId; loader: ViewLoader }
  | { kind: "deeplink"; loader: ViewLoader }
  | { kind: "not-found" };

/**
 * 解析 main 区 pathname 应渲染的视图。
 *
 * 决策顺序：
 * 1. 路由域反查 → 命中归属应用的 entry route（tabView，如 /app/github/repo/x → /app/github）
 * 2. deepLink 前缀匹配 → 命中（如 /article/x、/app/editor/x）
 * 3. 都未命中 → not-found
 *
 * 注意：tabView 判定要求该 entry route 在 tabLoaders 注册表里有 loader。
 * hiddenFromNav 应用的 entry route 注册成 deepLinkView 而非 tabView，
 * 故其子路径走 deepLink 分支（路由域仍归属该应用，但渲染走 deepLink 容器）。
 */
export function resolveMainView(pathname: string): ViewResolution {
  // 1. 路由域反查 → tabView
  const entryRoute = routeDomainRegistry.entryRouteForPath(pathname);
  if (entryRoute) {
    const tabLoader = getTabLoader(entryRoute);
    if (tabLoader) {
      return { kind: "tab", tabId: entryRoute, loader: tabLoader };
    }
    // entryRoute 命中但无 tabLoader（hiddenFromNav 应用，entry route 注册成 deepLink）
    // → 走 deepLink 分支
  }

  // 2. deepLink 前缀匹配
  const deepLinkLoader = getDeepLinkLoader(pathname);
  if (deepLinkLoader) {
    return { kind: "deeplink", loader: deepLinkLoader };
  }

  // 3. 都未命中
  return { kind: "not-found" };
}
