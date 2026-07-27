/**
 * RouteContract：一个路由节点的声明式契约（类型安全的源头）。
 *
 * 设计意图（2026-07-27）：
 * 替代旧的 ViewLoader + asView + 字符串 path 的松散组合。
 * 每个 Route 携带：
 * - id：全局唯一标识，codegen 汇总为 RouteId 联合类型
 * - pattern：相对路径段，与父级拼接成绝对路径
 * - params/search：zod schema，运行时 parse + 类型推导源头
 * - component：视图懒加载器
 * - children：嵌套子 Route（无限层）
 *
 * 类型参数：
 * - P：params schema 类型（ZodSchema 或 undefined）
 * - S：search schema 类型（ZodSchema 或 undefined）
 *
 * 类型推导链：
 *   defineRoute({ params: z.object({...}) })
 *     → RouteContract<ZodObject<{...}>, undefined>
 *     → codegen 生成 RouteParamsMap['xxx'] = z.infer<ZodObject<{...}>>
 */
import type { Component } from "svelte";
import type { ZodSchema } from "zod";

/**
 * 一个路由节点的声明式契约。
 *
 * 字段全部 readonly，构造后不可变。defineRoute 是唯一构造入口。
 */
export interface RouteContract<
  P extends ZodSchema | undefined = ZodSchema | undefined,
  S extends ZodSchema | undefined = ZodSchema | undefined,
> {
  /** 全局唯一 id（如 'github.repo.detail'），codegen 汇总为 RouteId 联合类型。 */
  readonly id: string;
  /** 相对 pattern（不含父级前缀），如 'repo/:owner/:repo' 或 ''（index route）。 */
  readonly pattern: string;
  /** pathname 参数 schema（zod）。undefined 表示无参数。 */
  readonly params?: P;
  /** search 参数 schema（zod）。undefined 表示无 query 参数。 */
  readonly search?: S;
  /** 视图懒加载器（与旧 ViewLoader 同语义）。 */
  readonly component: () => Promise<{ default: Component }>;
  /** 嵌套子路由。 */
  readonly children?: readonly RouteContract[];
}

/**
 * 已擦除泛型的 RouteContract（用于树遍历、注册表存储等场景）。
 *
 * 泛型只在 defineRoute 的开发期类型检查有用；运行时统一存为 ErasedRouteContract。
 * codegen 生成的 routes 表也用此类型。
 */
export type ErasedRouteContract = RouteContract<ZodSchema | undefined, ZodSchema | undefined>;
