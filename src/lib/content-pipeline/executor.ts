/**
 * 管道执行器 + 缓存（单例）。
 *
 * 职责：
 * 1. 用给定的 VfsReader 执行所有注册的 source（读 VFS → ContentEntry[]）。
 * 2. 执行所有注册的 processor（ContentEntry[] → ProcessResult）。
 * 3. 缓存 entries 与 results，供查询层（contentQuery）读取。
 *
 * 缓存策略：
 * - entriesCache 按 collection 分桶；run() 时整体重建（编辑器写入后调 refresh）。
 * - resultsCache 按 processor id 索引。
 *
 * 注意：执行器本身不关心 reader 来源（readonlyVfs 或 vfsStore-backed reader），
 * 由调用方（contentQuery）注入，保证 SSR 安全（管道只在 browser 执行）。
 */
import { contentPipelineRegistry } from "./registry";
import type { ContentEntry, ProcessResult, VfsReader } from "./types";

class PipelineExecutor {
  private entriesCache = new Map<string, ContentEntry[]>();
  private resultsCache = new Map<string, ProcessResult>();

  /** 用给定的 reader 执行所有注册的 source + processor。 */
  run(reader: VfsReader): void {
    // 1. 执行所有 source，按 collection 收集 entries
    const entriesByCollection = new Map<string, ContentEntry[]>();
    const allEntries: ContentEntry[] = [];
    for (const source of contentPipelineRegistry.getSources()) {
      const entries = source.read(reader);
      entriesByCollection.set(source.collection, entries);
      allEntries.push(...entries);
    }

    this.entriesCache = entriesByCollection;

    // 2. 执行所有 processor，传入全量 entries
    const results = new Map<string, ProcessResult>();
    for (const processor of contentPipelineRegistry.getProcessors()) {
      const result = processor.process(allEntries);
      results.set(result.id, result);
    }
    this.resultsCache = results;
  }

  /** 查询某 collection 的所有 entry（未排序，按 source 产出顺序）。 */
  getEntries(collection: string): ContentEntry[] {
    return this.entriesCache.get(collection) ?? [];
  }

  /** 查询所有 collection 的所有 entry（合并）。 */
  getAllEntries(): ContentEntry[] {
    const all: ContentEntry[] = [];
    for (const entries of this.entriesCache.values()) {
      all.push(...entries);
    }
    return all;
  }

  /** 查询处理器产物。 */
  getResult(id: string): ProcessResult | undefined {
    return this.resultsCache.get(id);
  }

  /** 清空缓存（调试/卸载时用）。 */
  clear(): void {
    this.entriesCache.clear();
    this.resultsCache.clear();
  }
}

/** 全局单例。 */
export const pipelineExecutor = new PipelineExecutor();
