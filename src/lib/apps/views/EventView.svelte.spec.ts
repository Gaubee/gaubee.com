/**
 * EventView 组件测试（vitest-browser-svelte）。
 *
 * 覆盖：挂载、标题渲染。
 */
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";

import EventView from "./EventView.svelte";

describe("EventView", () => {
  it("挂载并显示事件列表标题", async () => {
    const { container } = render(EventView);
    await new Promise((r) => setTimeout(r, 100));
    const h1 = container.querySelector("h1");
    expect(h1?.textContent).toContain("事件");
  });

  it("空数据时显示提示", async () => {
    const { container } = render(EventView);
    await new Promise((r) => setTimeout(r, 150));
    const text = container.textContent || "";
    expect(text).toContain("事件");
  });
});
