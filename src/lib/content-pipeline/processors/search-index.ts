/**
 * 搜索索引处理器。
 *
 * 把 ContentEntry[] 转成 SearchIndexDocument[]（与构建脚本产物格式一致），
 * 供运行时需要搜索文档投影的消费方使用。
 *
 * 注意：静态搜索索引仍由 scripts/build-search-index.ts 构建并作为分片提供
 * （file-service.ts 从 static/search-index/*.json 加载）。
 * 本处理器固化同一套投影算法，让运行时也能拿到一致的 SearchIndexDocument[]，
 * 替代 build-search-index.ts 内联的 loadDocuments 逻辑（约束 4：格式兼容）。
 */
import type { SearchIndexDocument } from "$lib/search/minisearch";

import type { ContentEntry, ContentProcessor, ProcessResult } from "../types";

const PROCESSOR_ID = "search-index";
const RESULT_TYPE = "search-index";

/** 从 path 推导集合目录名（'articles' | 'events'）。 */
function directoryFromPath(path: string): string {
  // path 形如 'src/content/articles/0057.xxx.md'
  const segments = path.split("/");
  return segments[2] ?? "articles";
}

/** 从 entry 生成搜索文档（与 build-search-index.ts 同构）。 */
export function entryToSearchDocument(entry: ContentEntry): SearchIndexDocument {
  const directory = directoryFromPath(entry.path);
  return {
    id: entry.path,
    title: entry.title,
    content: entry.body,
    tags: entry.tags.join(" "),
    excerpt: entry.excerpt,
    href: `/article/${directory}/${entry.id.stem}`,
    date: entry.date.getTime(),
  };
}

/** 按 date 降序 + id 字母序兜底（与构建脚本一致）。 */
export function sortSearchDocuments(docs: SearchIndexDocument[]): SearchIndexDocument[] {
  return docs.sort((left, right) => right.date - left.date || left.id.localeCompare(right.id));
}

/** search-index 处理器单例。 */
export const searchIndexProcessor: ContentProcessor = {
  id: PROCESSOR_ID,
  type: RESULT_TYPE,
  process(entries: ContentEntry[]): ProcessResult {
    const docs = sortSearchDocuments(entries.map(entryToSearchDocument));
    return {
      id: PROCESSOR_ID,
      type: RESULT_TYPE,
      data: docs,
    };
  },
};
