/**
 * 正交意图：
 * 1. 原始需求（2026-07-21）：使用 Intl.Segmenter 优化中文搜索。
 * 2. 锁定中文语义词和单字回退 token 的召回契约。
 */
import { describe, expect, it } from "vitest";
import { tokenizeSearchText } from "./minisearch";

describe("tokenizeSearchText", () => {
  it("保留 Intl.Segmenter 的中文词，并补充中文单字", () => {
    const tokens = tokenizeSearchText("响应式编程 Signals");

    expect(tokens).toContain("响应");
    expect(tokens).toContain("响");
    expect(tokens).toContain("signals");
  });
});
