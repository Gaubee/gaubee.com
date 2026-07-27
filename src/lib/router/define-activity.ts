/**
 * defineActivity：Activity 声明工厂（类型安全版本）。
 *
 * 设计意图（2026-07-27）：
 * 替代 AppActivity 字面量，在工厂内部校验：
 * - pattern 是绝对路径（以 '/' 开头）
 * - root 是合法 RouteContract
 * - root.pattern 通常为 ''（index route，代表「Activity 入口」）
 *
 * 运行时数据结构与 AppActivity 完全一致，只是多一层 DEV 校验。
 *
 * 注意：defineActivity 不替代 defineApp。
 * manifest.activities 数组里用 defineActivity 生成每一项。
 */
import type { ErasedRouteContract, RouteContract } from "./contract";
import { registerActivityRoot } from "./define-route";

/** defineActivity 配置。 */
export interface DefineActivityConfig {
  /** Activity 的绝对 pattern（如 '/app/github'）。 */
  pattern: string;
  /** Activity 的根 Route 树（root.pattern 通常为 ''）。 */
  root: RouteContract;
  /** 是否为应用入口场景（Dock 图标身份）。 */
  entry?: boolean;
  /** 是否从 Dock 任务栏隐藏。 */
  hiddenFromNav?: boolean;
}

/** 工厂：构造一个 Activity 声明，并把 root 子树的 absolutePattern 回填到 routeRegistry。
 *
 * @example
 * defineActivity({
 *   pattern: "/app/github",
 *   entry: true,
 *   root: githubHomeRoute,
 * })
 */
export function defineActivity(config: DefineActivityConfig): DefineActivityConfig {
  if (import.meta.env.DEV) {
    if (!config.pattern.startsWith("/")) {
      console.warn(`[defineActivity] pattern "${config.pattern}" 应以 '/' 开头（绝对路径）`);
    }
    if (config.pattern !== "/" && config.pattern.endsWith("/")) {
      console.warn(`[defineActivity] pattern "${config.pattern}" 不应以 '/' 结尾`);
    }
    // root 通常应是 index route（pattern === ''），但允许非空（极少数场景）
    if (config.root.pattern !== "") {
      console.warn(
        `[defineActivity] Activity "${config.pattern}" 的 root pattern 为 "${config.root.pattern}"（推荐为 ''，让 root 仅作入口）`,
      );
    }
  }
  // 把 root 子树的 absolutePattern 回填到 routeRegistry（覆盖 defineRoute 时的占位值）
  registerActivityRoot(config.pattern, config.root);
  return config;
}

/** 把 defineActivity 的返回值擦除泛型（用于存储/遍历）。 */
export type ErasedActivity = DefineActivityConfig & {
  readonly root: ErasedRouteContract;
};
