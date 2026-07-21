/**
 * 正交意图：
 * 1. 原始需求（2026-07-21）：搜索应用必须提供可用的搜索输入与动态结果区。
 * 2. 覆盖视图的初始可访问结构，不耦合任何具体应用服务。
 */
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import SearchView from "./SearchView.svelte";

describe("SearchView", () => {
  it("渲染带可访问名称的搜索输入", () => {
    const { container } = render(SearchView);

    const input = container.querySelector('input[type="search"]');
    expect(input?.getAttribute("aria-label")).toBe("搜索内容");
    expect(container.textContent).toContain("输入关键词开始搜索");
  });
});
