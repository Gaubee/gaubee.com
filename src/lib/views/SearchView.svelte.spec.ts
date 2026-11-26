/**
 * 正交意图：
 * 1. 原始需求（2026-07-21）：搜索应用必须提供可用的搜索输入与动态结果区。
 * 2. 覆盖视图的初始可访问结构，不耦合任何具体应用服务。
 * 3. 覆盖 AI 入口的能力门控与「AI 面板 / 普通结果」互斥。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";

import SearchView from "./SearchView.svelte";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SearchView", () => {
  it("渲染带可访问名称的搜索输入", () => {
    const { container } = render(SearchView);

    const input = container.querySelector('input[type="search"]');
    expect(input?.getAttribute("aria-label")).toBe("搜索内容");
    expect(container.textContent).toContain("输入关键词开始搜索");
  });

  it("AI 可用时显示入口，展开后与普通结果互斥", async () => {
    vi.stubGlobal("LanguageModel", {
      availability: vi.fn(async () => "available"),
      create: vi.fn(async () => ({ prompt: vi.fn(), destroy: vi.fn() })),
    });

    const { container } = render(SearchView);
    await vi.waitFor(() => {
      expect(container.querySelector('button[aria-label="AI 搜索助手"]')).not.toBeNull();
    });

    const aiButton = container.querySelector(
      'button[aria-label="AI 搜索助手"]',
    ) as HTMLButtonElement;
    expect(aiButton.getAttribute("aria-expanded")).toBe("false");

    aiButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const panel = container.querySelector("#ai-chat-panel");
    expect(panel).not.toBeNull();
    expect(aiButton.getAttribute("aria-expanded")).toBe("true");
    expect(panel?.parentElement?.hasAttribute("hidden")).toBe(false);
    expect(container.textContent).not.toContain("输入关键词开始搜索");
    expect(container.textContent).toContain("内置模型官方支持英/西/日/德/法，中文回答可能不稳定。");

    aiButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(container.textContent).toContain("输入关键词开始搜索");
    expect(panel?.parentElement?.hasAttribute("hidden")).toBe(true);
  });
});
