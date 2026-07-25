/**
 * ZenFS 单例（浏览器环境懒加载）。
 *
 * 正交意图：
 * 1. 原始需求（2026-07-25）：用 ZenFS 替换手写 VFS，提供标准 Node fs 语义 + IndexedDB 持久化。
 *
 * 设计：
 * - 懒加载：首次调用 getFs() 时才 configure（避免 SSR/prerender 阶段访问 IndexedDB）。
 * - 单一 ZenFS 实例（configureSingle 保证全局唯一），用目录区分用途：
 *   /workspace → 主工作区（文本编辑、内容管理）
 *   /git → isomorphic-git clone 持久化
 * - IndexedDB 后端仅支持 storeName（ZenFS 内部统一管理数据库名）。
 */
import { configureSingle, fs as zenfs } from "@zenfs/core";
import { IndexedDB } from "@zenfs/dom";

/** ZenFS fs 实例类型（Node fs 兼容命名空间）。 */
export type ZenFs = typeof zenfs;

let initPromise: Promise<ZenFs> | null = null;

/**
 * 获取 ZenFS fs 实例（懒加载，幂等）。
 * 首次调用配置 IndexedDB 后端，后续返回同一实例。
 * @throws SSR 环境下调用（IndexedDB 不可用）
 */
export function getFs(): Promise<ZenFs> {
  if (typeof indexedDB === "undefined") {
    throw new Error("ZenFS 需要 IndexedDB（不支持 SSR/prerender）");
  }
  if (!initPromise) {
    initPromise = configureSingle({
      backend: IndexedDB,
      storeName: "gaubee-fs",
    }).then(() => zenfs);
  }
  return initPromise;
}

/**
 * 同步获取已初始化的 fs 实例（init 完成后可用）。
 * 未初始化时返回 null（调用方应先用 getFs() 初始化）。
 */
export function getCachedFs(): ZenFs | null {
  return initPromise ? zenfs : null;
}

/**
 * 重置 ZenFS 单例（仅测试用）。
 *
 * 丢弃缓存的 initPromise，使下次 getFs() 重新 configure。
 * 测试场景配合 fake-indexeddb 注入新的 indexedDB 实例时调用。
 * 注意：configureSingle 内部可能缓存了已 mount 的 fs，重置后 ZenFS 全局状态
 * 会被覆盖（新 backend 替换旧的）。生产代码不要调用。
 */
export function _resetZenFsForTest(): void {
  initPromise = null;
}
