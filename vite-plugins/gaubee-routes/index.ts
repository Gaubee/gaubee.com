/**
 * vite-plugin-gaubee-routes：路由类型 codegen 插件。
 *
 * 设计意图（2026-07-27）：
 * 为 GaubeeOS 的类型安全路由系统生成编译期类型文件 `.gaubee/routes.generated.d.ts`，
 * 提供跨应用引用时的 RouteId 联合类型 + RouteParamsMap + RouteSearchMap 类型映射。
 *
 * 工作原理：
 * 1. 扫描 src/lib/apps 下的 manifest 文件（约定路径：apps/{name}/routes.ts）
 * 2. 用 TypeScript Compiler API 解析 AST，提取每个 defineRoute 调用的：
 *    - id（字符串字面量）
 *    - params/search schema 引用（如果是命名 export 的 schema 常量）
 *    - absolutePattern（通过父级 Activity 的 pattern + Route pattern 拼接，需要分析 defineActivity）
 * 3. 生成 .d.ts 文件，内容是：
 *    - import 各 app 的 schema 常量
 *    - type RouteId = 'github' | 'github.repo.detail' | ...
 *    - interface RouteParamsMap { 'github.repo.detail': z.infer<typeof repoDetailParams>; ... }
 *
 * 渐进增强策略：
 * - 运行时 routeRegistry 自动填充（不依赖此插件）
 * - 此插件仅生成类型，让 targetById/goById 拿到编译期类型保护
 * - 插件失败时降级到宽松类型（RouteId = string），不影响运行
 *
 * 当前实现状态（阶段 3 完善）：
 * - 骨架已建，scanner/generator 待补全
 * - 现阶段先返回不做事的 placeholder 插件，确保 vite 配置能加载
 */
import type { Plugin } from "vite";

export interface GaubeeRoutesPluginOptions {
  /** 应用源码根目录（默认 src/lib/apps）。 */
  appsRoot?: string;
  /** 生成文件路径（默认 .gaubee/routes.generated.d.ts）。 */
  outputFile?: string;
  /** 是否启用（默认 dev=true, build=true）。 */
  enabled?: boolean;
}

/**
 * 创建 GaubeeOS 路由 codegen 插件。
 *
 * 用法（vite.config.ts）：
 * ```ts
 * import { gaubeeRoutes } from "./vite-plugins/gaubee-routes";
 * export default defineConfig({
 *   plugins: [gaubeeRoutes()],
 * });
 * ```
 */
export function gaubeeRoutes(_options: GaubeeRoutesPluginOptions = {}): Plugin {
  return {
    name: "gaubee-routes-codegen",
    enforce: "pre",
    async configResolved() {
      // 阶段 3 实现：扫描 + 生成
      // 当前为骨架，运行时 routeRegistry 已自描述，类型层待完善
    },
    async buildStart() {
      // 阶段 3 实现
    },
    handleHotUpdate(_ctx) {
      // 阶段 3 实现：routes 文件变化时重新生成
    },
  };
}
