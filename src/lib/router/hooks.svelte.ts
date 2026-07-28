/**
 * Router hooks：Svelte 5 runes 风格的上下文消费 API。
 *
 * 设计意图（2026-07-27）：
 * AppShell 在 mount 时通过 setRouterContext 下发 context getter，
 * 视图组件通过 useRoute/useParams/useSearch 拿到响应式数据。
 *
 * 响应式模型（关键修复 2026-07-27）：
 * useParams/useSearch 返回 **getter 函数**，调用方需用 $derived 包装读取。
 *
 * 为什么用 getter 而非直接返回值：
 * $derived 只能在组件 setup 的编译期作用域被识别，无法跨函数边界传递。
 * 返回 getter 让调用方在组件里写 `const owner = $derived(getParams()?.owner)`，
 * 显式建立响应式追踪（访问 getParams() 时读取 ActivityRouter 的 ctxValue $derived）。
 *
 * 旧 bug：useParams 直接返回 ctx.params 快照，导致 URL 变化时组件不响应
 * （如 RepoDetailView 切换 ?sha=xxx 不重新加载 commit detail，刷新才行）。
 *
 * 注意：hooks 必须在 Svelte 组件 setup 阶段调用（context API 限制）。
 */
import { getContext, hasContext, setContext } from "svelte";

import type { ErasedRouteContract } from "./contract";
import type { MatchedRouteNode, RouteMatchResult } from "./match";

/** Router 上下文中的 Activity 形状（结构类型，避免循环依赖 apps/types）。
 *  与 AppActivity 运行时等价，root 用擦除泛型版本。 */
export interface RouterActivity {
  readonly pattern: string;
  readonly root: ErasedRouteContract;
  readonly entry?: boolean;
  readonly hiddenFromNav?: boolean;
}

/** Router 上下文值（AppShell 下发）。 */
export interface RouterContextValue {
  /** 当前激活的 Activity。 */
  readonly activity: RouterActivity;
  /** 完整 location（含 pathname / search）。 */
  readonly location: {
    readonly pathname: string;
    readonly search: string;
  };
  /** 路由匹配结果。 */
  readonly match: RouteMatchResult;
  /** 当前叶子节点的 parsed params（matched 时才有值）。 */
  readonly params: Readonly<Record<string, unknown>> | undefined;
  /** 当前叶子节点的 parsed search（matched 时才有值）。 */
  readonly search: Readonly<Record<string, unknown>> | undefined;
  /** 匹配链（root → ... → leaf）。 */
  readonly chain: readonly MatchedRouteNode[];
}

/** 上下文存储形式：getter 函数。
 *  Svelte 5 context 只能 setContext 一次，但数据随 location 变化，
 *  用 getter 让消费方每次调用都拿到最新值（响应式追踪在调用点发生）。 */
interface RouterContextEntry {
  readonly get: () => RouterContextValue;
}

const ROUTER_CONTEXT_KEY = Symbol("gaubee:router");

/** 在 AppShell 中注入 router 上下文（向下传递给视图组件）。
 *  接收 getter 函数，保证 location 变化时消费方拿到最新数据。 */
export function setRouterContext(getValue: () => RouterContextValue): void {
  setContext<RouterContextEntry>(ROUTER_CONTEXT_KEY, { get: getValue });
}

/** 检测是否在 AppShell 上下文内（用于防御性编程）。
 *  返回当时的快照值——若需响应式，用 useParams/useSearch 的 getter 形式。 */
export function useRouterContext(): RouterContextValue | null {
  if (!hasContext(ROUTER_CONTEXT_KEY)) return null;
  const entry = getContext<RouterContextEntry>(ROUTER_CONTEXT_KEY);
  return entry.get();
}

/** 内部工具：获取 context getter。 */
function requireContextGetter(): () => RouterContextValue {
  if (!hasContext(ROUTER_CONTEXT_KEY)) {
    throw new Error("[router] useRoute/useParams/useSearch 必须在 <AppShell> 内调用");
  }
  return getContext<RouterContextEntry>(ROUTER_CONTEXT_KEY).get;
}

/** 获取当前匹配的叶子 Route 节点的 getter。
 *  调用方在 $derived / $effect / 模板中调用 getter，自动响应 location 变化。
 *
 * @example
 * const getRoute = useRoute();
 * const leaf = $derived(getRoute?.());  // 响应式
 */
export function useRoute(): (() => Readonly<MatchedRouteNode> | undefined) | undefined {
  if (!hasContext(ROUTER_CONTEXT_KEY)) return undefined;
  const get = requireContextGetter();
  return () => {
    const ctx = get();
    if (ctx.match.kind !== "matched") return undefined;
    return ctx.chain[ctx.chain.length - 1];
  };
}

/** 获取当前叶子节点 params 的 getter。
 *  调用方需用 $derived 包装读取，才能响应 URL 变化。
 *
 * @example
 * const getParams = useParams<RouteParamsMap["github.repo.detail"]>();
 * const owner = $derived(getParams?.()?.owner);  // 响应式
 */
export function useParams<T = Record<string, unknown>>(): (() => T | undefined) | undefined {
  if (!hasContext(ROUTER_CONTEXT_KEY)) return undefined;
  const get = requireContextGetter();
  return () => get().params as T | undefined;
}

/** 获取当前叶子节点 search 的 getter。
 *  调用方需用 $derived 包装读取，才能响应 URL search 变化。
 *
 * @example
 * const getSearch = useSearch<RouteSearchMap["github.repo.detail"]>();
 * const tab = $derived(getSearch?.()?.tab ?? "files");  // 响应式
 */
export function useSearch<T = Record<string, unknown>>(): (() => T | undefined) | undefined {
  if (!hasContext(ROUTER_CONTEXT_KEY)) return undefined;
  const get = requireContextGetter();
  return () => get().search as T | undefined;
}

/** 获取当前激活的 Activity 的 getter。 */
export function useActivity(): () => RouterActivity {
  const get = requireContextGetter();
  return () => get().activity;
}
