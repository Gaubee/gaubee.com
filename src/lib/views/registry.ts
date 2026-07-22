/**
 * View 注册表：把 TabId / pop 路由 / 深链接模式映射到对应的 Svelte 视图组件。
 *
 * - tab view：main/bottom 区的 tab，常驻 DOM（CSS 切换显示，组件保活）。
 * - pop view：模态弹层，按需挂载。
 * - deepLink view：main 区的非 tab 路径（如 /article/...、/tags/...），非常驻，
 *   activeTabId 为 null 时按路径匹配渲染。
 */
import type { Component } from "svelte";
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

export interface ViewEntry {
  /** 匹配的 TabId（tab view）或 pop 路由前缀（pop view）。 */
  id: string;
  component: Component;
}

/** tab view 注册表（按 TabId）。 */
const tabViews = new Map<TabId, Component>();

/** pop view 注册表（按 POP_ROUTES 前缀）。 */
const popViews = new Map<string, Component>();

/** 深链接 view 注册表（按路径前缀，按注册顺序匹配）。 */
const deepLinkViews: Array<{ pattern: string; component: Component }> = [];

export function registerTabView(tabId: TabId, component: Component): void {
  tabViews.set(tabId, component);
}

export function registerPopView(route: string, component: Component): void {
  popViews.set(route, component);
}

/** 注册深链接 view。pattern 是路径前缀（如 '/article'），匹配 pathname 以此开头。 */
export function registerDeepLinkView(
  pattern: string,
  component: Component,
): void {
  deepLinkViews.push({ pattern, component });
}

export function getTabView(tabId: TabId): Component | undefined {
  return tabViews.get(tabId);
}

export function getPopView(route: string): Component | undefined {
  if (popViews.has(route)) return popViews.get(route);
  for (const [prefix, component] of popViews) {
    if (route.startsWith(prefix + "/") || route === prefix) return component;
  }
  return undefined;
}

/** 按路径查找深链接 view（第一个匹配的 pattern）。 */
export function getDeepLinkView(pathname: string): Component | undefined {
  for (const { pattern, component } of deepLinkViews) {
    if (pathname === pattern || pathname.startsWith(pattern + "/")) {
      return component;
    }
  }
  return undefined;
}

/** 所有已注册的 tab view（供 area-outlet 常驻渲染）。 */
export function getAllTabViews(): ReadonlyArray<{
  tabId: TabId;
  component: Component;
}> {
  return Array.from(tabViews.entries()).map(([tabId, component]) => ({
    tabId,
    component,
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
