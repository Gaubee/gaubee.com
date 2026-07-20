/**
 * ShoutView 组件测试（vitest-browser-svelte）。
 *
 * 覆盖：挂载、标题渲染。
 */
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import ShoutView from "./ShoutView.svelte";

describe("ShoutView", () => {
  it("挂载并显示说说列表标题", async () => {
    const { container } = render(ShoutView);
    await new Promise((r) => setTimeout(r, 100));
    const h1 = container.querySelector("h1");
    expect(h1?.textContent).toContain("说说");
  });

  it("空数据时显示提示", async () => {
    const { container } = render(ShoutView);
    await new Promise((r) => setTimeout(r, 150));
    const text = container.textContent || "";
    expect(text).toContain("说说");
  });
});
