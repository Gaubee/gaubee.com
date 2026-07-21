/**
 * 正交意图：
 * 1. 原始需求（2026-07-21）：说说列表必须正确渲染 Markdown。
 * 2. 锁定内联预览的基础 Markdown 结构。
 */
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import MarkdownViewer from "./MarkdownViewer.svelte";

describe("MarkdownViewer", () => {
  it("在内联模式保留 Markdown 的强调与链接结构", () => {
    const { container } = render(MarkdownViewer, {
      markdown: "这是 **重点**，也是 [链接](https://example.com)。",
      inline: true,
    });

    expect(container.querySelector("strong")?.textContent).toBe("重点");
    expect(container.querySelector("a")?.getAttribute("href")).toBe(
      "https://example.com",
    );
  });
});
