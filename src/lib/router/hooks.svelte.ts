/**
 * Router hooks：Svelte 5 runes 风格的上下文消费 API。
 *
 * 设计意图（2026-07-27）：
 * AppShell 在 mount 时通过 setRouterContext 下发：
 * - 当前 Activity
 * - 当前 location
 * - 匹配链 chain（RouteMatchResult）
 * - 已 parse 的 params/search（来自叶子节点）
 *
 * 视图组件通过 useRoute/useParams/useSearch 拿到强类型数据。
 *
 * 类型约定：
 * useRoute<T> / useParams<T> / useSearch<T> 接受泛型参数，
 * 调用方应从 codegen 类型（RouteParamsMap 等）传入。
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

/**
 * 上下文存储形式：getter 函数。
 *
 * 为什么用 getter 而非直接存值：
 * Svelte 5 的 context API 在 setContext 时只接受一次值。
 * 但 router 上下文的数据（match/params/search）随 location 变化而变化，
 * 用 getter 让消费方每次访问都拿到最新值（响应式追踪在 getter 调用点发生）。
 */
interface RouterContextEntry {
  readonly get: () => RouterContextValue;
}

const ROUTER_CONTEXT_KEY = Symbol("gaubee:router");

/** 在 AppShell 中注入 router 上下文（向下传递给视图组件）。
 *  接收 getter 函数，保证 location 变化时消费方拿到最新数据。 */
export function setRouterContext(getValue: () => RouterContextValue): void {
  setContext<RouterContextEntry>(ROUTER_CONTEXT_KEY, { get: getValue });
}

/** 检测是否在 AppShell 上下文内（用于防御性编程）。 */
export function useRouterContext(): RouterContextValue | null {
  if (!hasContext(ROUTER_CONTEXT_KEY)) return null;
  const entry = getContext<RouterContextEntry>(ROUTER_CONTEXT_KEY);
  return entry.get();
}

/** 获取当前 Router 上下文（必须存在，否则抛错）。
 *  适用于 AppShell 直接渲染的视图组件。 */
function requireContext(): RouterContextValue {
  const ctx = useRouterContext();
  if (!ctx) {
    throw new Error("[router] useRoute/useParams/useSearch 必须在 <AppShell> 内调用");
  }
  return ctx;
}

/** 获取当前匹配的叶子 Route 节点。 */
export function useRoute(): Readonly<MatchedRouteNode> | undefined {
  const ctx = requireContext();
  if (ctx.match.kind !== "matched") return undefined;
  const chain = ctx.chain;
  return chain[chain.length - 1];
}

/** 获取当前叶子节点的 params（调用方可传泛型约束形状）。
 *
 * @example
 * const params = useParams<RouteParamsMap["github.repo.detail"]>();
 * // params.owner / params.repo 类型安全
 */
export function useParams<T = Record<string, unknown>>(): T | undefined {
  const ctx = requireContext();
  return ctx.params as T | undefined;
}

/** 获取当前叶子节点的 search。
 *
 * @example
 * const search = useSearch<RouteSearchMap["github.repo.detail"]>();
 * // search.tab 类型安全
 */
export function useSearch<T = Record<string, unknown>>(): T | undefined {
  const ctx = requireContext();
  return ctx.search as T | undefined;
}

/** 获取当前激活的 Activity。 */
export function useActivity(): RouterActivity {
  return requireContext().activity;
}
