/**
 * navigate：类型安全的导航 API（替代裸字符串 navigateMain）。
 *
 * 设计意图（2026-07-27）：
 * 提供两种入口，覆盖「同应用内」与「跨应用」两种场景：
 *
 * 1. 直接传 Route 单例（go / buildHref / buildTarget）
 *    - 同应用内引用：直接 import 自己应用的 Route 常量，零依赖
 *    - 类型参数从 RouteContract 自动推导，无需 codegen
 *
 * 2. 字符串 RouteId（goById / buildHrefById / buildTargetById）
 *    - 跨应用引用：不 import 目标应用的 Route 模块（解耦）
 *    - 依赖 codegen 生成的 RouteId / RouteParamsMap / RouteSearchMap
 *    - 未 codegen 时，类型回退到宽松（id: string, params: Record<string, unknown>）
 *
 * 设计权衡：
 * - 直接 Route 单例：编译期类型安全最强，但跨应用要 import
 * - 字符串 id：解耦最强，类型安全依赖 codegen 完整性
 * 两者并存，由调用方按场景选择。
 *
 * 与 NavController 的关系：
 * navigate API 是 NavController.navigateMain 的类型安全封装，
 * 内部委托给一个 RouteRegistry（按 id → RouteContract）。
 */
import type { ZodSchema, infer as zInfer } from "zod";

import type { ErasedRouteContract, RouteContract } from "./contract";
import { compilePattern } from "./path-pattern";
import type { RouteRegistryEntry } from "./registry";
import { routeRegistry } from "./registry";
import { stringifySearch } from "./search";

/** 浏览器 history 动作类型（与 NavController 对齐）。 */
export type NavAction = "PUSH" | "REPLACE";

// re-export registry 单例（兼容旧 import 路径）
export { routeRegistry } from "./registry";
export type { RouteRegistryEntry } from "./registry";

// ---------------------------------------------------------------------------
// 类型工具：从 RouteContract 提取 params/search 的 inferred 类型
// ---------------------------------------------------------------------------

/** 提取 RouteContract 的 params inferred 类型（schema 为 undefined 时为 undefined）。 */
export type RouteParams<T extends RouteContract> =
  T extends RouteContract<infer P, infer _S>
    ? P extends ZodSchema
      ? zInfer<P>
      : undefined
    : never;

/** 提取 RouteContract 的 search inferred 类型。 */
export type RouteSearch<T extends RouteContract> =
  T extends RouteContract<infer _P, infer S>
    ? S extends ZodSchema
      ? zInfer<S>
      : undefined
    : never;

// ---------------------------------------------------------------------------
// API 1：直接传 Route 单例（同应用内引用）
// ---------------------------------------------------------------------------

/** 类型安全的导航目标（直接 Route 单例版本）。 */
export interface RouteTarget<T extends RouteContract> {
  readonly route: T;
  readonly params: RouteParams<T>;
  readonly search?: RouteSearch<T>;
  readonly action?: NavAction;
}

/** 构造一个导航目标（直接 Route 单例）。
 *  运行时不触发导航，仅生成 target，可存入 NotificationAction.to 等。 */
export function target<T extends RouteContract>(
  route: T,
  ...args: RouteParams<T> extends undefined ? [] : [params: RouteParams<T>]
): RouteTarget<T>;
export function target<T extends RouteContract>(
  route: T,
  ...args: RouteParams<T> extends undefined ? [] : [params: RouteParams<T>]
): RouteTarget<T> {
  const params = args[0] as RouteParams<T> | undefined as RouteParams<T>;
  return { route, params };
}

/** 构造 href（直接 Route 单例）。
 *  需要传入父级 absolutePattern，因为 Route 单例只持有相对 pattern。
 *  通常通过 useRouteContext() 拿到当前 chain 的 absolutePattern。 */
export function buildHref<T extends RouteContract>(
  route: T,
  parentAbsolute: string,
  ...args: RouteParams<T> extends undefined ? [] : [params: RouteParams<T>]
): string;
export function buildHref<T extends RouteContract>(
  route: T,
  parentAbsolute: string,
  ...args: RouteParams<T> extends undefined ? [] : [params: RouteParams<T>]
): string {
  const params = args[0] as RouteParams<T> | undefined;
  const pattern = joinPatternForBuild(parentAbsolute, route.pattern);
  return stringifyRoute(pattern, params);
}

// ---------------------------------------------------------------------------
// API 2：字符串 RouteId（跨应用引用，依赖 codegen 类型）
// ---------------------------------------------------------------------------

/**
 * 全局 Route id 联合类型（codegen 产物）。
 *
 * codegen 完成前为 `string`（宽松），完成后变为字面量联合（严格）。
 * 通过 declaration merging 让 codegen 文件扩展此类型。
 */
export type RouteId = string;

/** RouteId → params 类型映射（codegen 产物）。
 *
 * 设计：空接口 + declaration merging。
 * - 未声明（codegen 前）：RouteParamsMap['xxx'] 为 unknown（默认索引签名），
 *   targetById/buildHrefById 的 params 参数可选（条件类型 unknown extends undefined → false → 要求参数，
 *   但我们用宽松策略：params 总是可选，运行时由 routeRegistry 校验）。
 * - 声明后（codegen 后）：具体 RouteId 的 params 类型被锁定。
 *
 * 注意：索引用 `unknown` 而非 `undefined`，避免 declaration merging 时
 * 具体类型与索引签名冲突（TS 要求具体类型可赋给索引签名类型）。
 */
export interface RouteParamsMap {
  [id: string]: unknown;
}

/** RouteId → search 类型映射（codegen 产物）。 */
export interface RouteSearchMap {
  [id: string]: unknown;
}

/** 字符串 id 版本的导航目标。 */
export interface IdTarget<R extends RouteId = RouteId> {
  readonly routeId: R;
  readonly params?: RouteParamsMap[R];
  readonly search?: RouteSearchMap[R];
  readonly action?: NavAction;
}

/** 构造一个 id 目标（跨应用引用场景）。
 *  params 可选：无参数 Route 传一个参数，有参数 Route 传两个。 */
export function targetById<R extends RouteId>(routeId: R, params?: RouteParamsMap[R]): IdTarget<R> {
  return { routeId, params };
}

/** 按 id 构造 href。
 *  从 routeRegistry 查到 RouteRegistryEntry，取其 absolutePattern 渲染。 */
export function buildHrefById<R extends RouteId>(routeId: R, params?: RouteParamsMap[R]): string {
  const entry = routeRegistry.get(routeId);
  if (!entry) {
    if (import.meta.env.DEV) {
      console.error(`[buildHrefById] route id "${routeId}" 未在 routeRegistry 注册`);
    }
    return "/";
  }
  return stringifyRoute(entry.absolutePattern, params);
}

// ---------------------------------------------------------------------------
// 共用工具
// ---------------------------------------------------------------------------

/** 拼接父级绝对 pattern 与子级相对 pattern。 */
function joinPatternForBuild(parentAbsolute: string, relative: string): string {
  const p = parentAbsolute.replace(/\/+$/, "");
  const r = relative.replace(/^\/+|\/+$/g, "");
  if (r === "") return p;
  return `${p}/${r}`;
}

/** 把 pattern + params 渲染成完整路径（含 search）。
 *  params 为 undefined 时，pattern 中的 :name 保留原样（DEV 警告）。
 *  search 参数在第三个可选参数中传递。 */
function stringifyRoute(pattern: string, params: unknown, search?: unknown): string {
  const paramRecord = (params ?? {}) as Record<string, string>;
  const href = stringifyPattern(pattern, paramRecord);
  const searchStr = search ? stringifySearch(search as Record<string, unknown>) : "";
  return `${href}${searchStr}`;
}

/** 把带 :param 的 pattern 渲染成实际路径（无 search）。 */
function stringifyPattern(pattern: string, params: Readonly<Record<string, string>>): string {
  const compiled = compilePattern(pattern);
  let result = pattern;
  // 替换 :name → 值
  for (const name of compiled.paramNames) {
    const val = params[name];
    if (val === undefined) {
      if (import.meta.env.DEV) {
        console.warn(`[stringifyPattern] pattern "${pattern}" 缺少参数 ${name}`);
      }
      continue;
    }
    result = result.replace(`:${name}`, encodeURIComponent(val));
  }
  // 去掉尾部可选斜杠（构建时统一无尾斜杠）
  return result.replace(/\/+$/, "") || "/";
}

// ---------------------------------------------------------------------------
// 执行导航（委托 NavController）
// ---------------------------------------------------------------------------

/**
 * NavController 适配器接口。
 * navigate API 通过此接口调用底层 NavController，避免直接 import 单例造成循环依赖。
 * 由 nav-controller-instance.ts 注入具体实现。
 */
export interface NavControllerAdapter {
  navigateMain(path: string, action?: NavAction): void;
  focusApp(tabId: string): void;
  openApp(tabId: string): void;
  activatePop(path: string): void;
  deactivatePop(): void;
}

let navAdapter: NavControllerAdapter | null = null;

/** 注入 NavController 适配器（在 nav-controller-instance.ts 启动时调用）。 */
export function setNavControllerAdapter(adapter: NavControllerAdapter): void {
  navAdapter = adapter;
}

/** 获取已注入的适配器。未注入时抛错（DEV）或返回 null。 */
function getAdapter(): NavControllerAdapter | null {
  if (!navAdapter && import.meta.env.DEV) {
    console.error("[navigate] NavController adapter 未注入，请检查 nav-controller-instance.ts");
  }
  return navAdapter;
}

/** 执行导航（直接 Route 单例版本）。 */
export function go<T extends RouteContract>(
  route: T,
  parentAbsolute: string,
  ...args: RouteParams<T> extends undefined ? [] : [params: RouteParams<T>]
): void;
export function go<T extends RouteContract>(
  route: T,
  parentAbsolute: string,
  ...args: RouteParams<T> extends undefined ? [] : [params: RouteParams<T>]
): void {
  // 实现签名：args 已由重载签名约束，此处用宽放断言调用 buildHref
  // （TS 对条件类型 + spread 的推断有限，运行时契约由重载保证）
  const href = buildHref(route, parentAbsolute, ...(args as never));
  const adapter = getAdapter();
  adapter?.navigateMain(href);
}

/** 执行导航（字符串 RouteId 版本）。 */
export function goById<R extends RouteId>(routeId: R, params?: RouteParamsMap[R]): void {
  const href = buildHrefById(routeId, params);
  const adapter = getAdapter();
  adapter?.navigateMain(href);
}

/** 解析一个 IdTarget 并执行导航（NotificationAction.to 等场景）。 */
export function goTarget(t: IdTarget): void {
  goById(t.routeId, t.params as RouteParamsMap[RouteId]);
}
