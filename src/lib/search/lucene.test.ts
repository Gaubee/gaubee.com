/**
 * 正交意图：
 * 1. 原始需求（2026-07-21）：搜索必须支持按应用筛选的 Lucene 表达式。
 * 2. 验证表达式能转换为 MiniSearch 可执行查询，而不是由视图猜测语法。
 */
import MiniSearch from "minisearch";
import { describe, expect, it } from "vitest";
import { parseLuceneQuery } from "./lucene";
import { createMiniSearchIndex, type SearchIndexDocument } from "./minisearch";

const documents: SearchIndexDocument[] = [
  {
    id: "signals",
    title: "Signals proposal",
    content: "TC39 signals and observable proposal",
    tags: "javascript",
    excerpt: "signals",
    href: "/article/articles/signals",
    date: 2,
  },
  {
    id: "archived-signals",
    title: "Old signals",
    content: "signals archive",
    tags: "archive",
    excerpt: "archived signals",
    href: "/article/articles/old-signals",
    date: 1,
  },
];

describe("parseLuceneQuery", () => {
  it("分离 app 分组筛选，并保留标题短语搜索", () => {
    const query = parseLuceneQuery(
      'app:(articles OR shout) title:"Signals proposal"',
    );

    expect(query.includeAppIds).toEqual(["articles", "shout"]);
    expect(query.excludeAppIds).toEqual([]);
    expect(query.engineQuery).not.toBeNull();
  });

  it("将 NOT 字段条件翻译为 MiniSearch 的 AND_NOT 查询", () => {
    const query = parseLuceneQuery("app:articles signals AND NOT tags:archive");
    const index = createMiniSearchIndex();
    index.addAll(documents);
    const results = index.search(query.engineQuery ?? MiniSearch.wildcard);

    expect(query.includeAppIds).toEqual(["articles"]);
    expect(results.map((result) => result.id)).toEqual(["signals"]);
  });

  it("拒绝未闭合的 Lucene 分组", () => {
    expect(() => parseLuceneQuery("app:(articles OR shout")).toThrow("右括号");
  });
});
