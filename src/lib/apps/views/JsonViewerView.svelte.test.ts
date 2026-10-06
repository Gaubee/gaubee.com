/**
 * JSON 查看器组件级回归：验证大 JSON 真实走到虚拟树时只挂载窗口行。
 * 该测试必须使用 client project；server project 无法运行 ResizeObserver。
 */
import { mount, tick, unmount } from "svelte";
import { describe, expect, it, vi } from "vitest";

import JsonVirtualTree from "./json-viewer/JsonVirtualTree.svelte";
import JsonViewerView from "./JsonViewerView.svelte";

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

describe("JsonVirtualTree 组件", () => {
  it("超过 5000 节点时只挂载远少于总行数的可见行", async () => {
    const target = document.createElement("div");
    target.style.height = "520px";
    target.style.width = "900px";
    target.style.minHeight = "0";
    target.style.overflow = "hidden";
    document.body.append(target);
    const component = mount(JsonVirtualTree, {
      target,
      props: { value: Array.from({ length: 6000 }, (_, index) => ({ id: index })) },
    });
    await tick();
    await nextFrame();

    const rows = target.querySelectorAll(".jv-virtual-row");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(100);
    expect(target.querySelector<HTMLElement>(".jv-virtual-scroll")?.clientHeight).toBeGreaterThan(
      0,
    );

    await unmount(component);
    target.remove();
  });
});

describe("JsonViewerView 历史落盘", () => {
  it("解析成功后等待防抖才写入 localStorage", async () => {
    vi.useFakeTimers();
    localStorage.clear();
    const target = document.createElement("div");
    target.style.height = "700px";
    document.body.append(target);
    const component = mount(JsonViewerView, { target });
    await tick();
    target.querySelector<HTMLButtonElement>('button[title^="填充一份"]')?.click();
    await tick();
    await vi.advanceTimersByTimeAsync(300);
    expect(localStorage.getItem("gaubee:json-viewer:history")).toBeNull();
    await vi.advanceTimersByTimeAsync(2000);
    expect(localStorage.getItem("gaubee:json-viewer:history")).toContain("features");
    await unmount(component);
    target.remove();
    localStorage.clear();
    vi.useRealTimers();
  });
});
