/**
 * GithubApp 异步资源状态机抽象（state/）。
 *
 * 收口 GithubApp 内散落的 loading/error/data 三元组样板，提供：
 * - createResource：runes 工厂（状态机派生 + 竞态防护 + refreshing/stale-error + silent + setData）
 * - AsyncBoundary：泛型状态机渲染边界（loading→skeleton / error→ErrorState / empty→EmptyState / refreshing→指示条+旧数据）
 * - EmptyState / ErrorState / RefreshIndicator：统一的占位/错误/刷新指示组件
 *
 * 设计文档见 AGENTS.md「加载状态机」章节（2026-07-28）。
 */
export { default as AsyncBoundary } from "./AsyncBoundary.svelte";
export { default as EmptyState } from "./EmptyState.svelte";
export { default as ErrorState } from "./ErrorState.svelte";
export { default as RefreshIndicator } from "./RefreshIndicator.svelte";
export {
  createResource,
  type Resource,
  type ReadonlyResource,
  type CreateResourceOptions,
} from "./resource.svelte";
export {
  deriveStatus,
  hasRenderableData,
  isErrorStatus,
  isPendingStatus,
  type ResourceStatus,
  type ResourceStatusInput,
} from "./status";
