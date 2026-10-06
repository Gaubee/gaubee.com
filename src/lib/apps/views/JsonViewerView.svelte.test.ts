/**
 * JSON 查看器组件级回归：验证大 JSON 真实走到虚拟树时只挂载窗口行。
 * 该测试必须使用 client project；server project 无法运行 ResizeObserver。
 */
import { mount, tick, unmount } from "svelte";
import { describe, expect, it, vi } from "vitest";

import JsonStreamTree from "./json-viewer/JsonStreamTree.svelte";
import JsonVirtualTree from "./json-viewer/JsonVirtualTree.svelte";
import { initialStreamCtx, step } from "./json-viewer/stream-protocol";
import { StreamRowModel } from "./json-viewer/stream-rows";
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

  it("虚拟树截断超长字符串预览", async () => {
    const target = document.createElement("div");
    target.style.height = "520px";
    target.style.width = "900px";
    document.body.append(target);
    const component = mount(JsonVirtualTree, {
      target,
      props: { value: { payload: "x".repeat(5_000_000) } },
    });
    await tick();
    await nextFrame();
    const value = target.querySelector<HTMLElement>(".jv-value");
    expect(value?.textContent).toBe(`"${"x".repeat(120)}…"`);
    await unmount(component);
    target.remove();
  });
});

describe("JsonStreamTree 组件", () => {
  it("按虚拟窗口挂载聚合行，而不是一次性渲染所有碎片", async () => {
    const target = document.createElement("div");
    target.style.height = "520px";
    target.style.width = "900px";
    document.body.append(target);
    const model = new StreamRowModel({ aggregateThreshold: 2 });
    const result = step(initialStreamCtx(), `[${"0,".repeat(5_000)}0]`);
    expect(result.error).toBeUndefined();
    model.append(result.events);
    const component = mount(JsonStreamTree, { target, props: { model } });
    await tick();
    await nextFrame();
    const expandedCount = target.querySelectorAll(".jv-stream-row").length;
    expect(expandedCount).toBeGreaterThan(0);
    expect(expandedCount).toBeLessThan(100);
    await tick();
    await nextFrame();
    expect(target.textContent).toContain("5001 items");
    target.querySelector<HTMLButtonElement>(".jv-stream-toggle")?.click();
    await tick();
    await nextFrame();
    const collapsedCount = target.querySelectorAll(".jv-stream-row").length;
    expect(collapsedCount).toBeLessThan(expandedCount);
    target.querySelector<HTMLButtonElement>(".jv-stream-toggle")?.click();
    await tick();
    await nextFrame();
    expect(target.querySelectorAll(".jv-stream-row").length).toBeGreaterThan(collapsedCount);
    await unmount(component);
    target.remove();
  });
});

describe("JsonViewerView 历史落盘", () => {
  it("未处于激活应用上下文时不监听窗口级快捷键", async () => {
    const target = document.createElement("div");
    target.style.height = "700px";
    document.body.append(target);
    const component = mount(JsonViewerView, { target });
    await tick();
    const event = new KeyboardEvent("keydown", {
      key: "v",
      ctrlKey: true,
      shiftKey: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    await unmount(component);
    target.remove();
  });

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

  it("历史 Dialog 提供点击恢复和删除入口", async () => {
    localStorage.setItem(
      "gaubee:json-viewer:history",
      JSON.stringify([{ id: "1", content: '{"ok":true}', savedAt: 1, bytes: 11 }]),
    );
    const target = document.createElement("div");
    target.style.height = "700px";
    document.body.append(target);
    const component = mount(JsonViewerView, { target });
    await tick();
    target.querySelector<HTMLButtonElement>('button[title="查看最近打开的 10 条 JSON"]')?.click();
    await tick();
    expect(document.querySelector('button[title="点击恢复"]')).not.toBeNull();
    const remove = document.querySelector<HTMLButtonElement>('button[title="删除这条历史"]');
    expect(remove).not.toBeNull();
    remove?.click();
    await tick();
    expect(JSON.parse(localStorage.getItem("gaubee:json-viewer:history") ?? "[]")).toEqual([]);
    await unmount(component);
    target.remove();
    localStorage.clear();
  });

  it("diff Dialog 使用结构化解析错误和修复建议", async () => {
    const target = document.createElement("div");
    target.style.height = "700px";
    document.body.append(target);
    const component = mount(JsonViewerView, { target });
    await tick();
    target.querySelector<HTMLButtonElement>('button[title="对比两份 JSON 的键级差异"]')?.click();
    await tick();
    const left = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="原始 JSON"]');
    const right = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="新 JSON"]');
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    if (!left || !right) return;
    left.value = '{"a":1,}';
    left.dispatchEvent(new Event("input", { bubbles: true }));
    right.value = "{}";
    right.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector<HTMLButtonElement>('button[title="执行 JSON 对比"]')?.click();
    await tick();
    const alert = document.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("原始 JSON");
    expect(alert?.textContent).toContain("建议");
    await unmount(component);
    target.remove();
  });

  it("YAML 循环引用在转换 Dialog 中显示人话错误", async () => {
    const target = document.createElement("div");
    target.style.height = "700px";
    document.body.append(target);
    const component = mount(JsonViewerView, { target });
    await tick();
    target.querySelector<HTMLButtonElement>('button[title^="填充一份"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 300));
    target
      .querySelector<HTMLButtonElement>(
        'button[title="转换为 YAML、TypeScript 类型或 JSON Schema"]',
      )
      ?.click();
    await tick();
    const yamlTab = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "YAML → JSON",
    );
    yamlTab?.click();
    await tick();
    const input = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="YAML 输入"]');
    expect(input).not.toBeNull();
    if (!input) return;
    input.value = "self: &root\n  value: *root";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await tick();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("循环引用");
    await unmount(component);
    target.remove();
  });
});
