/**
 * 正交意图：
 * 1. 原始需求（2026-07-21）：TOC 必须在长文中定位到真实标题。
 * 2. 锁定 Markdown 渲染和 TOC 共用的 GFM 标题 ID 契约。
 */
import { describe, expect, it } from "vitest";
import { extractMarkdownHeadings } from "./headings";

describe("extractMarkdownHeadings", () => {
  it("使用 GFM 规则处理中文与重复标题", () => {
    const headings = extractMarkdownHeadings(
      "# 标题\n\n## 第一节\n\n### 细节 *with emphasis*\n\n## 第一节",
    );

    expect(headings).toEqual([
      { level: 2, text: "第一节", id: "第一节" },
      { level: 3, text: "细节 with emphasis", id: "细节-with-emphasis" },
      { level: 2, text: "第一节", id: "第一节-1" },
    ]);
  });
});
