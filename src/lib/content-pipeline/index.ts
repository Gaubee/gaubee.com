/**
 * 内容管道（Content Pipeline）公开 API。
 *
 * 分层：
 * - types:        核心数据模型与接口
 * - excerpt:      统一摘要算法
 * - registry:     插件注册表（source + processor）
 * - executor:     管道执行器 + 缓存
 * - query:        统一查询层（contentQuery 单例）
 * - sources:      内置内容源（articles / events）
 * - processors:   内置处理器（tags / search-index）
 */
export { createExcerpt } from "./excerpt";
export { contentPipelineRegistry } from "./registry";
export { pipelineExecutor } from "./executor";
export { contentQuery } from "./query.svelte";
export type { TagCount } from "./query.svelte";
export type {
  ContentEntry,
  ContentProcessor,
  ContentSource,
  ProcessResult,
  VfsReader,
} from "./types";
