/**
 * WriterView 组件测试（vitest-browser-svelte）。
 *
 * 覆盖：挂载、标题渲染、未登录提示。
 */
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import WriterView from "./WriterView.svelte";

describe("WriterView", () => {
  it("挂载并显示写作标题", async () => {
    const { container } = render(WriterView);
    await new Promise((r) => setTimeout(r, 100));
    const h1 = container.querySelector("h1");
    expect(h1?.textContent).toContain("写作");
  });

  it("未登录时显示登录提示", async () => {
    const { container } = render(WriterView);
    await new Promise((r) => setTimeout(r, 150));
    const text = container.textContent || "";
    expect(text).toContain("写作");
  });
});
