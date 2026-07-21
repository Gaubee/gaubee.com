/**
 * 正交意图：
 * 1. 原始需求（2026-07-21）：文件类应用使用 MiniSearch + Intl.Segmenter 搜索 VFS。
 * 2. 统一构建期与浏览器反序列化期必须共享的索引配置。
 */
import MiniSearch, { type Options } from "minisearch";

/** 被索引的 VFS Markdown 文档。 */
export interface SearchIndexDocument {
  id: string;
  title: string;
  content: string;
  tags: string;
  excerpt: string;
  href: string;
  date: number;
}

const HAN_CHARACTER = /\p{Script=Han}/u;
const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });

/**
 * 以 Intl.Segmenter 切词，同时保留中文单字以提高中文短查询召回。
 * 英文词、数字与 CJK 语义词都保留为完整 token。
 */
export function tokenizeSearchText(text: string): string[] {
  const tokens = new Set<string>();
  for (const segment of segmenter.segment(text)) {
    const value = segment.segment.trim().toLocaleLowerCase("zh-CN");
    if (!value) continue;
    if (segment.isWordLike) tokens.add(value);
    if (HAN_CHARACTER.test(value)) {
      for (const character of value) {
        if (HAN_CHARACTER.test(character)) tokens.add(character);
      }
    }
  }
  return [...tokens];
}

/** MiniSearch 的唯一配置源，构建与运行时必须一致。 */
export const miniSearchOptions: Options<SearchIndexDocument> = {
  fields: ["title", "content", "tags"],
  storeFields: ["title", "content", "excerpt", "href", "date"],
  tokenize: tokenizeSearchText,
  searchOptions: {
    tokenize: tokenizeSearchText,
    boost: { title: 3, tags: 2 },
  },
};

/** 创建一个可序列化的文件搜索索引。 */
export function createMiniSearchIndex(): MiniSearch<SearchIndexDocument> {
  return new MiniSearch<SearchIndexDocument>(miniSearchOptions);
}
