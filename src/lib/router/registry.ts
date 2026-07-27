/**
 * RouteRegistry：id → RouteContract 单例的全局注册表。
 *
 * 设计意图（2026-07-27）：
 * 独立成单独文件，作为 router 模块的共享基础设施。
 * define-route / match / navigate 都依赖它，但谁也不依赖谁（无循环）。
 *
 * 数据来源：
 * - defineRoute 工厂在构造 RouteContract 时自动注册（运行时自描述）
 * - defineActivity 在挂载 root 时回填 absolutePattern
 *
 * 注意：注册表只存 RouteContract 的运行时数据，
 * 编译期类型（RouteId / RouteParamsMap）由 vite-plugin codegen 生成 .d.ts 提供。
 */
import type { ErasedRouteContract } from "./contract";

/** 一个 Route 在注册表中的条目。 */
export interface RouteRegistryEntry {
  /** Route id。 */
  readonly id: string;
  /** Route 契约。 */
  readonly route: ErasedRouteContract;
  /** 绝对 pattern（含全部父级前缀，如 '/app/github/repo/:owner/:repo'）。
   *  由 defineActivity 挂载时计算并注册。 */
  readonly absolutePattern: string;
}

class RouteRegistry {
  private readonly map = new Map<string, RouteRegistryEntry>();

  register(entry: RouteRegistryEntry, opts: { silent?: boolean } = {}): void {
    const existing = this.map.get(entry.id);
    if (existing && import.meta.env.DEV && !opts.silent) {
      // 仅在「非同一对象」时警告（同一 Route 被 defineRoute + defineActivity 两次注册是预期）
      // existing.route 与 entry.route 是同一对象 → 静默
      if (existing.route !== entry.route) {
        console.warn(
          `[RouteRegistry] route id "${entry.id}" 已被不同 RouteContract 占用，覆盖（这是 bug，请检查 id 重复）`,
        );
      }
    }
    this.map.set(entry.id, entry);
  }

  get(id: string): RouteRegistryEntry | undefined {
    return this.map.get(id);
  }

  has(id: string): boolean {
    return this.map.has(id);
  }

  /** 列出全部已注册的 route id（调试用）。 */
  listIds(): readonly string[] {
    return Array.from(this.map.keys());
  }

  /** 列出全部条目（codegen 扫描用）。 */
  listEntries(): readonly RouteRegistryEntry[] {
    return Array.from(this.map.values());
  }

  clear(): void {
    this.map.clear();
  }
}

/** 全局 Route 注册表单例。 */
export const routeRegistry = new RouteRegistry();
