/**
 * defineRoute：RouteContract 的类型安全工厂。
 *
 * 设计意图（2026-07-27）：
 * 唯一的 RouteContract 构造入口。承担：
 * 1. 类型参数推导：从 zod schema 自动推导 P/S 泛型
 * 2. 运行时校验（DEV）：pattern 合法性、id 命名规范
 * 3. 运行时自注册：构造后立即把 Route 单例 + 子树注册到 routeRegistry
 *    （vite-plugin codegen 仅作为编译期类型层增强，运行时不依赖）
 *
 * 父子关系（absolutePattern 计算）：
 * - 顶层 Route（Activity root）的 absolutePattern 由 defineActivity 挂载时回填
 * - 嵌套子 Route 的 absolutePattern 由父级 defineRoute 调用时通过 closure 推算
 *
 * 与 defineActivity 的区别：
 * - defineRoute 描述「一个路由节点」（可嵌套）
 * - defineActivity 描述「一个屏幕场景」，挂在 manifest.activities[] 上，
 *   持有一棵 Route 树（root）
 *
 * 命名约定（推荐，便于 codegen 与跨应用引用）：
 *   route id = '<app>.<scene>.<sub>'.toLowerCase()
 *   如 'github' / 'github.repo.detail' / 'articles.detail'
 */
import type { Component } from "svelte";
import type { ZodSchema } from "zod";

import type { ErasedRouteContract, RouteContract } from "./contract";
import { routeRegistry } from "./registry";

/** defineRoute 配置。 */
export interface DefineRouteConfig<
  P extends ZodSchema | undefined = ZodSchema | undefined,
  S extends ZodSchema | undefined = ZodSchema | undefined,
> {
  /** 全局唯一 id（如 'github.repo.detail'）。 */
  id: string;
  /** 相对 pattern，如 'repo/:owner/:repo' 或 ''（index）。 */
  pattern: string;
  /** pathname 参数 schema。 */
  params?: P;
  /** search 参数 schema。 */
  search?: S;
  /** 视图懒加载器。 */
  component: () => Promise<{ default: Component }>;
  /** 嵌套子路由。 */
  children?: readonly RouteContract[];
}

/** 工厂：构造一个 RouteContract 并自注册到 routeRegistry。
 *
 * @example
 * defineRoute({
 *   id: "github.repo.detail",
 *   pattern: "repo/:owner/:repo",
 *   params: z.object({ owner: z.string(), repo: z.string() }),
 *   search: z.object({ tab: z.enum(["files","history"]).default("files") }),
 *   component: () => import("./RepoDetailView.svelte"),
 * })
 */
export function defineRoute<
  P extends ZodSchema | undefined = undefined,
  S extends ZodSchema | undefined = undefined,
>(config: DefineRouteConfig<P, S>): RouteContract<P, S> {
  if (import.meta.env.DEV) {
    validateRouteId(config.id);
    validatePattern(config.pattern);
  }
  const route: RouteContract<P, S> = {
    id: config.id,
    pattern: config.pattern,
    params: config.params,
    search: config.search,
    component: config.component,
    children: config.children,
  };
  // 自注册到 routeRegistry（运行时自描述）。
  // 顶层 Route 的 absolutePattern 暂为 pattern（占位），
  // 待 defineActivity 挂载时由 registerActivityRoot 回填正确值。
  registerRouteRecursive(route, route.pattern || "/");
  return route;
}

/** 递归注册 Route 自身 + 子树。
 *  parentAbsolute 是当前 Route 的绝对 pattern。 */
function registerRouteRecursive(route: ErasedRouteContract, parentAbsolute: string): void {
  routeRegistry.register({
    id: route.id,
    route,
    absolutePattern: parentAbsolute,
  });
  if (route.children) {
    for (const child of route.children) {
      const childAbs = joinAbsolute(parentAbsolute, child.pattern);
      registerRouteRecursive(child, childAbs);
    }
  }
}

/** 当一个 Route 被作为 Activity root 使用时，回填其 absolutePattern（含 Activity 前缀）。
 *  由 defineActivity 调用。会覆盖 defineRoute 时的占位值。 */
export function registerActivityRoot(activityPattern: string, root: ErasedRouteContract): void {
  registerActivityRootRecursive(activityPattern, root);
}

function registerActivityRootRecursive(activityPattern: string, route: ErasedRouteContract): void {
  const abs = joinAbsolute(activityPattern, route.pattern);
  routeRegistry.register({ id: route.id, route, absolutePattern: abs });
  if (route.children) {
    for (const child of route.children) {
      registerActivityRootRecursive(abs, child);
    }
  }
}

/** 拼接父级绝对 pattern 与子级相对 pattern。 */
function joinAbsolute(parentAbsolute: string, relative: string): string {
  const p = parentAbsolute.replace(/\/+$/, "");
  const r = relative.replace(/^\/+|\/+$/g, "");
  if (r === "") return p || "/";
  return `${p}/${r}`;
}

/** DEV 校验：route id 应是点号分隔的小写标识符（推荐 'app.scene.sub'）。 */
function validateRouteId(id: string): void {
  if (!id) {
    console.warn("[defineRoute] route id 不能为空");
    return;
  }
  if (!/^[a-z][a-z0-9-]*(\.[a-z0-9-]+)*$/i.test(id)) {
    console.warn(
      `[defineRoute] route id "${id}" 不符合推荐格式（应是小写点号分隔，如 'github.repo.detail'）`,
    );
  }
}

/** DEV 校验：pattern 只允许静态段、:param、空字符串。 */
function validatePattern(pattern: string): void {
  // 替换掉所有合法的 :param 后，剩余应只有字母数字-_/
  const stripped = pattern.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, "");
  if (!/^[A-Za-z0-9_\-/]*$/.test(stripped)) {
    console.warn(`[defineRoute] pattern "${pattern}" 含非法字符（仅支持静态段 + :param）`);
  }
  if (pattern.includes("*")) {
    console.warn(
      `[defineRoute] pattern "${pattern}" 不支持通配符 *（如需可选，用 zod 在 search 中表达）`,
    );
  }
}
