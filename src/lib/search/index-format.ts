/**
 * 正交意图：
 * 1. 原始需求（2026-07-21）：按应用、时间排序生成约 500 KiB 的多个索引文件。
 * 2. 定义构建产物与运行时文件搜索服务共享的 manifest 格式。
 */
export interface SearchIndexShard {
  file: string;
  documentCount: number;
  newestDate: number;
  oldestDate: number;
  bytes: number;
}

export interface SearchIndexApplication {
  appId: string;
  documentCount: number;
  shards: readonly SearchIndexShard[];
}

export interface SearchIndexManifest {
  version: 1;
  applications: readonly SearchIndexApplication[];
}
