/**
 * GithubView 组件测试（vitest-browser-svelte）。
 *
 * GithubApp 推倒重设计后的新 UI：仓库选择器 + 4 Tab（历史/文件/变更/日志）。
 * 覆盖：挂载、标题与仓库标识渲染、4 个 Tab 触发器、默认仓库（主仓库）标记。
 *
 * 网络层（listCommits / listContents / getFileText）与 GitService 在此 mock，
 * 避免触达真实 GitHub API / Worker 代理。
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";

// mock github/client（REST API 调用）
vi.mock("$lib/github/client", () => ({
  OWNER: "gaubee",
  REPO: "gaubee.com",
  BRANCH: "main",
  listCommits: vi.fn().mockResolvedValue([]),
  listContents: vi.fn().mockResolvedValue([]),
  getFileText: vi.fn().mockResolvedValue(""),
}));

// mock VFS（变更 Tab 调用 dirtyFiles）
vi.mock("$lib/vfs/vfs.svelte", () => ({
  vfs: { dirtyFiles: vi.fn().mockResolvedValue([]) },
  vfsStore: {},
}));

// mock 活动日志（日志 Tab 读 activities）
const mockActivities = vi.fn().mockReturnValue([]);
vi.mock("$lib/apps/installable/github/activity-log.svelte", () => ({
  activityLog: {
    init: vi.fn().mockResolvedValue(undefined),
    get activities() {
      return mockActivities();
    },
  },
}));

// mock os/services（requestAppService / handlePublishError 等）
vi.mock("$lib/os/services", () => ({
  gaubeeos: { requestAppService: vi.fn() },
}));
vi.mock("$lib/os/services/publish-helper", () => ({
  handlePublishError: vi.fn(),
}));
vi.mock("$lib/nav/nav-controller-instance", () => ({
  navController: {},
}));
vi.mock("$lib/apps/builtin/notifications/service.svelte", () => ({
  notifySuccess: vi.fn(),
  notifyWarning: vi.fn(),
}));

import GithubView from "./GithubView.svelte";

describe("GithubView", () => {
  it("挂载并显示 Github 标题与默认仓库", async () => {
    const { container } = render(GithubView);
    await new Promise((r) => setTimeout(r, 100));
    const h1 = container.querySelector("h1");
    expect(h1?.textContent).toContain("Github");
    // 默认仓库标识 owner/repo
    expect(container.textContent).toContain("gaubee/gaubee.com");
  });

  it("渲染 4 个 Tab（历史/文件/变更/日志）", async () => {
    const { container } = render(GithubView);
    await new Promise((r) => setTimeout(r, 100));
    const text = container.textContent || "";
    expect(text).toContain("历史");
    expect(text).toContain("文件");
    expect(text).toContain("变更");
    expect(text).toContain("日志");
  });

  it("默认仓库标记为主仓库", async () => {
    const { container } = render(GithubView);
    await new Promise((r) => setTimeout(r, 100));
    expect(container.textContent).toContain("主仓库");
  });
});
