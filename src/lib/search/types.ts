/**
 * 正交意图：
 * 1. 原始需求（2026-07-21）：搜索应用自身只提供扩展协议。
 * 2. 定义应用注册异步搜索闭包时共享的任务、批次与结果契约。
 */
import type { Query } from "minisearch";

/** 搜索应用已解析的 Lucene 查询。 */
export interface SearchQuery {
  source: string;
  includeAppIds: readonly string[];
  excludeAppIds: readonly string[];
  engineQuery: Query | null;
}

/** 分发给应用搜索服务的单次任务。 */
export interface SearchTask {
  query: SearchQuery;
  signal: AbortSignal;
}

/** 应用返回给搜索应用的标准化结果。 */
export interface SearchResult {
  id: string;
  appId: string;
  appName: string;
  title: string;
  excerpt: string;
  href: string;
  date: number;
  score: number;
}

/** 一个索引分片完成后产生的结果批次。 */
export interface SearchBatch {
  appId: string;
  appName: string;
  results: readonly SearchResult[];
  complete: boolean;
}

/**
 * 应用对搜索系统的唯一扩展点。
 *
 * 实现可按自身数据模型查询，并通过 AsyncIterable 逐批交付结果。
 */
export interface SearchService {
  readonly appId: string;
  readonly appName: string;
  search(task: SearchTask): AsyncIterable<SearchBatch>;
}

/** 应用 manifest 使用的延迟构造闭包。 */
export type SearchServiceFactory = () => SearchService;

/** 搜索应用协调多个服务时发出的进度事件。 */
export type SearchProgress =
  | { type: "batch"; batch: SearchBatch }
  | { type: "service-complete"; appId: string }
  | { type: "service-error"; appId: string; message: string }
  | { type: "complete" };
