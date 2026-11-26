/**
 * AiChat 组件测试：假 LanguageModel 驱动一次完整问答，验证输入、发送、回答与限制说明。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";

import AiChat from "./AiChat.svelte";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AiChat", () => {
  it("发送后显示助手回答与中文限制说明", async () => {
    const prompt = vi.fn(async () => '{"action":"final","answer":"你好，我是站内助手。"}');
    vi.stubGlobal("LanguageModel", {
      availability: vi.fn(async () => "available"),
      create: vi.fn(async () => ({ prompt, destroy: vi.fn() })),
    });

    const { container } = render(AiChat);
    expect(container.textContent).toContain("AI 会检索站内文章与事件");
    expect(container.textContent).toContain("内置模型官方支持英/西/日/德/法，中文回答可能不稳定。");

    const textarea = container.querySelector("textarea");
    expect(textarea).not.toBeNull();
    textarea!.value = "你好";
    textarea!.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const send = container.querySelector('button[aria-label="发送"]') as HTMLButtonElement | null;
    expect(send).not.toBeNull();
    expect(send!.disabled).toBe(false);
    send!.click();

    await vi.waitFor(
      () => {
        expect(container.textContent).toContain("你好，我是站内助手。");
      },
      { timeout: 3_000 },
    );
    expect(prompt).toHaveBeenCalledTimes(1);
  });
});
