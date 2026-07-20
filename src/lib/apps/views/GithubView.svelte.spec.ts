/**
 * GithubView 组件测试（vitest-browser-svelte）。
 *
 * 覆盖：挂载、标题渲染、仓库绑定表单。
 */
import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import GithubView from "./GithubView.svelte";

describe("GithubView", () => {
  it("挂载并显示 Github 标题", async () => {
    const { container } = render(GithubView);
    await new Promise((r) => setTimeout(r, 100));
    const h1 = container.querySelector("h1");
    expect(h1?.textContent).toContain("Github");
  });

  it("显示仓库绑定表单", async () => {
    const { container } = render(GithubView);
    await new Promise((r) => setTimeout(r, 100));
    const text = container.textContent || "";
    expect(text).toContain("绑定仓库");
    expect(text).toContain("克隆仓库");
  });
});
