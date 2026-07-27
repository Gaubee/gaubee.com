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
 */
import type { Component } from "svelte";

import { defineRoute } from "./define-route";

/** 为单页面 Activity 构造一个 index RouteContract。
 *
 * @param id      Route id（推荐 '<app>.home' 或直接 '<app>'）
 * @param loader  视图懒加载器
 * @returns RouteContract，pattern 为 ''，无 children
 *
 * @example
 * // settings 应用只有一屏
 * const settingsHome = leafRoute("settings", () => import("./SettingsView.svelte"));
 * // manifest
 * activities: [{ pattern: "/app/settings", entry: true, root: settingsHome }]
 */
export function leafRoute(id: string, loader: () => Promise<{ default: Component }>) {
  return defineRoute({
    id,
    pattern: "",
    component: loader,
  });
}
