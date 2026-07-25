/**
 * NotFound 处理器注册表 + 中间件链（方向二）。
 *
 * 当 URL 不匹配任何 tabView/deepLink/popView 时（resolveMainView 返回 not-found），
 * 跑中间件链让应用有机会接管（如 github 把 /app/github/不存在 重定向到列表页），
 * 都放行则 fallback 到系统默认 NotFound 组件。
 *
 * 中间件链执行顺序：
 * 1. 路径归属应用的 handler（路由域反查 appId === handler.appId）优先
 * 2. 其它应用的 handler（全局拦截，按注册顺序）
 * 3. 都 pass → 默认 NotFound 渲染
 *
 * 范式参考 registry.ts 的 register 单例 Map + route-domain 的路径归属反查。
 */
import { routeDomainRegistry } from "$lib/apps/route-domain";

/** NotFound 解析上下文（传给中间件 handler）。 */
export interface NotFoundContext {
  /** 触发 404 的路径。 */
  path: string;
  /** 路径归属的应用 id（路由域反查，null 表示无归属）。 */
  appId: string | null;
}

/** NotFound 处理结果。 */
export type NotFoundResult =
  | { kind: "redirect"; path: string } // 重定向到指定路径
  | { kind: "render" } // 用默认 NotFound 组件渲染
  | { kind: "pass" }; // 放行（调 next() 交给下一个中间件）

/** next() 的返回类型（放行给下游）。 */
type NextFn = () => NotFoundResult;

/** NotFound 中间件处理器。 */
export interface NotFoundHandler {
  /** 注册方应用 id（用于排序：归属应用优先）。 */
  appId: string;
  /** 处理函数：返回处理结果，或调 next() 放行。 */
  handle: (ctx: NotFoundContext, next: NextFn) => NotFoundResult;
}

/** 已注册的 NotFound 处理器列表。 */
const handlers: NotFoundHandler[] = [];

/** 注册 NotFound 处理器（应用级，可多个）。幂等（同 appId+handle 去重）。 */
export function registerNotFoundHandler(handler: NotFoundHandler): void {
  // 幂等：同 appId 且同 handle 引用不重复注册
  if (handlers.some((h) => h.appId === handler.appId && h.handle === handler.handle)) return;
  handlers.push(handler);
}

/** 注销指定应用的所有 NotFound 处理器。 */
export function unregisterNotFoundHandler(appId: string): void {
  for (let i = handlers.length - 1; i >= 0; i--) {
    if (handlers[i].appId === appId) handlers.splice(i, 1);
  }
}

/** 清空（测试用）。 */
export function _clearNotFoundHandlersForTest(): void {
  handlers.length = 0;
}

/**
 * 解析 NotFound：跑中间件链。
 *
 * 执行顺序：归属应用的 handler 优先 → 其它应用的 handler（注册顺序）→ 默认 render。
 * handler 调 next() 则交给下一个；返回 redirect/render 则短路。
 *
 * @param path 触发 404 的路径
 * @returns NotFoundResult（redirect / render / render 作为最终 fallback）
 */
export function resolveNotFound(path: string): NotFoundResult {
  const appId = routeDomainRegistry.appIdForPath(path);
  const ctx: NotFoundContext = { path, appId };

  // 归属应用的 handler 优先
  const owned = handlers.filter((h) => h.appId === appId);
  // 其它应用的 handler（全局拦截），按注册顺序
  const others = handlers.filter((h) => h.appId !== appId);
  const ordered = [...owned, ...others];

  // 构建中间件链：从最后一个开始包装，next() 调用上游
  let chain: NextFn = () => ({ kind: "render" as const }); // 末端：默认渲染
  // 从后往前包装，保证注册顺序靠前的先执行
  for (let i = ordered.length - 1; i >= 0; i--) {
    const handler = ordered[i];
    const prevNext = chain;
    chain = () => handler.handle(ctx, prevNext);
  }
  return chain();
}
