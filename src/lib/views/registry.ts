/**
 * View 注册表：把 TabId / pop 路由映射到对应的 Svelte 视图组件。
 *
 * area-outlet 根据 area 当前 location 的 pathname 找到激活的 view，
 * 所有已注册的 tab view 常驻 DOM（CSS 切换显示，组件保活，避免 CodeMirror 等重型组件重建）。
 * pop view 不常驻（模态弹层，每次打开重新挂载）。
 */
import type { Component } from 'svelte'
import type { Area, HistoryLocation, TabId } from '$lib/nav/controller'

export interface ViewEntry {
  /** 匹配的 TabId（tab view）或 pop 路由前缀（pop view）。 */
  id: string
  component: Component
}

/** tab view 注册表（按 TabId）。 */
const tabViews = new Map<TabId, Component>()

/** pop view 注册表（按 POP_ROUTES 前缀）。 */
const popViews = new Map<string, Component>()

export function registerTabView(tabId: TabId, component: Component): void {
  tabViews.set(tabId, component)
}

export function registerPopView(route: string, component: Component): void {
  popViews.set(route, component)
}

export function getTabView(tabId: TabId): Component | undefined {
  return tabViews.get(tabId)
}

export function getPopView(route: string): Component | undefined {
  // 精确匹配，或前缀匹配（如 /search → /search，/notifications → /notifications）
  if (popViews.has(route)) return popViews.get(route)
  for (const [prefix, component] of popViews) {
    if (route.startsWith(prefix + '/') || route === prefix) return component
  }
  return undefined
}

/** 所有已注册的 tab view（供 area-outlet 常驻渲染）。 */
export function getAllTabViews(): ReadonlyArray<{ tabId: TabId; component: Component }> {
  return Array.from(tabViews.entries()).map(([tabId, component]) => ({ tabId, component }))
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
  tabIdsInArea: readonly TabId[]
): TabId | null {
  if (area === 'pop') return null
  const path = location.pathname
  for (const tabId of tabIdsInArea) {
    if (path === tabId || path.startsWith(tabId + '/')) {
      return tabId
    }
  }
  return null
}
