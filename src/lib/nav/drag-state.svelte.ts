/**
 * 模块级拖拽状态：跨 AreaNav 实例共享当前被拖拽的 tabId。
 * 移植自 openspecui area-nav.tsx 的 _draggedTabId 模式（HTML5 DnD 简单有效）。
 */
import type { TabId } from './controller'

/** 当前被拖拽的 tabId（拖拽期间有效，dragend 清空）。 */
export let draggedTabId: TabId | null = null

export function setDraggedTab(tabId: TabId | null): void {
  draggedTabId = tabId
}
