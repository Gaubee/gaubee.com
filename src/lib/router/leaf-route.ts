/**
 * 单页面 Route 工厂：为只有一个入口视图的 Activity 快速构造 RouteContract。
 *
 * 设计意图（2026-07-27）：
 * 大多数简单应用（settings/shout/theme/files/search 等）只有一个屏幕，
 * 不需要嵌套子路由。本工厂提供一个语义化的快捷入口，避免每个应用都写
 * defineRoute({ id, pattern: "", component: () => import(...) })。
 *
 * 与多页面 Route（如 github.routes.ts）的区别：
 * - leafRoute 只创建一个 index route（无 children）
 * - 复杂应用应单独建 routes.ts 文件，组织 RouteContract 嵌套树
 *
 * search 参数（2026-07-28 增强）：
 * 简单场景下，单页面仍可能消费 query 参数（如 github-edit 的 owner/repo/file）。
 * 可选 search schema 让 leafRoute 也能类型安全地解析 query，无需退回 defineRoute。
 */
import type { Component } from "svelte";
import type { ZodSchema } from "zod";

import { defineRoute } from "./define-route";

/** 为单页面 Activity 构造一个 index RouteContract。
 *
 * @param id      Route id（推荐 '<app>.home' 或直接 '<app>'）
 * @param loader  视图懒加载器
 * @param search  可选 search 参数 schema（类型安全解析 query）
 * @returns RouteContract，pattern 为 ''，无 children
 *
 * @example
 * // settings 应用只有一屏
 * const settingsHome = leafRoute("settings", () => import("./SettingsView.svelte"));
 * // manifest
 * activities: [{ pattern: "/app/settings", entry: true, root: settingsHome }]
 *
 * @example
 * // 带 query 参数的单页面
 * const editRoute = leafRoute(
 *   "writer.github-edit",
 *   () => import("./EditorView.svelte"),
 *   z.object({ owner: z.string(), repo: z.string(), file: z.string() }),
 * );
 */
export function leafRoute<S extends ZodSchema | undefined = undefined>(
  id: string,
  loader: () => Promise<{ default: Component }>,
  search?: S,
) {
  return defineRoute({
    id,
    pattern: "",
    component: loader,
    search,
  });
}
