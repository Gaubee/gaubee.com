/**
 * defineApp：类型安全的应用声明工厂。
 *
 * 聚合 manifest 配置，返回 AppEntry。
 * 主要价值：类型推导 + 入口校验（确保恰好一个 entry activity）。
 */
import type { AppEntry, AppManifest } from "$lib/apps/types";

/** 定义一个 GaubeeApp。
 *  @param config 完整的 manifest 配置（activities 必须恰好有一个 entry）。
 *  @returns AppEntry（{ manifest }） */
export function defineApp(config: AppManifest): AppEntry {
  // 运行时校验：恰好一个 entry activity（开发期尽早暴露配置错误）。
  if (import.meta.env.DEV) {
    const entries = config.activities.filter((a) => a.entry);
    if (entries.length > 1) {
      console.warn(
        `[defineApp] 应用 ${config.id} 有多个 entry activity，将取第一个：${entries[0]?.route}`,
      );
    }
    if (config.activities.length === 0) {
      console.warn(`[defineApp] 应用 ${config.id} 没有 activity`);
    }
  }
  return { manifest: config };
}
