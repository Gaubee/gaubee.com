/**
 * Router 模块统一出口。
 *
 * 使用方应从此处 import，避免深入子文件：
 *   import { defineRoute, defineActivity, go, useRoute } from "$lib/router";
 *
 * 完整文档见各子文件顶部注释。
 */

// 契约与工厂
export type { RouteContract, ErasedRouteContract } from "./contract";
export { defineRoute, registerActivityRoot } from "./define-route";
export type { DefineRouteConfig } from "./define-route";
export { defineActivity } from "./define-activity";
export type { DefineActivityConfig, ErasedActivity } from "./define-activity";
export { leafRoute } from "./leaf-route";

// 注册表
export { routeRegistry } from "./registry";
export type { RouteRegistryEntry } from "./registry";

// 路径模式工具（高级用法，多数情况下用不到）
export { compilePattern, joinPattern, stringifyPattern } from "./path-pattern";

// 匹配与解析
export { matchRouteTree, parseSearchString } from "./match";
export type { MatchedRouteNode, RouteMatchResult } from "./match";

// 导航 API
export {
  // 直接 Route 单例版本
  target,
  buildHref,
  go,
  // 字符串 id 版本
  targetById,
  buildHrefById,
  goById,
  goTarget,
  // 适配器注入
  setNavControllerAdapter,
} from "./navigate";
export type {
  NavAction,
  RouteTarget,
  IdTarget,
  RouteId,
  RouteParamsMap,
  RouteSearchMap,
  RouteParams,
  RouteSearch,
  NavControllerAdapter,
} from "./navigate";

// Search 序列化工具
export { stringifySearch } from "./search";

// Hooks（Svelte 5 runes）
export {
  setRouterContext,
  useRoute,
  useParams,
  useSearch,
  useActivity,
  useRouterContext,
} from "./hooks.svelte";
export type { RouterContextValue } from "./hooks.svelte";
