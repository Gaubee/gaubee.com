/**
 * GithubView 组件测试（vitest-browser-svelte）。
 *
 * v3 架构：GithubView 是路由分发器，按 pathname 分发到列表页（RepoListView）
 * 或详情页（RepoDetailView）。本测试覆盖：
 * - 列表页渲染（默认 /app/github）：标题、搜索框、收藏卡片。
 * - 详情页分发（/app/github/repo/{owner}/{repo}）。
 *
 * 网络层（repo-api / client / VFS / activityLog）在此 mock。
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";

// mock repo-api（列表页 API）。listUserRepos/listOrgRepos 返回 RepoPage 结构。
// 注意：vi.mock 是 hoisted 的，不能引用顶层变量，emptyPage 内联。
vi.mock("$lib/apps/installable/github/repo-api", () => ({
  listUserRepos: vi.fn().mockResolvedValue({ repos: [], total: 0, hasMore: false, nextPage: null }),
  listUserOrgs: vi.fn().mockResolvedValue([]),
  listOrgRepos: vi.fn().mockResolvedValue({ repos: [], total: 0, hasMore: false, nextPage: null }),
  searchRepos: vi.fn().mockResolvedValue({ total: 0, items: [] }),
  getRepo: vi.fn().mockResolvedValue(null),
  listIssues: vi.fn().mockResolvedValue([]),
  searchIssues: vi.fn().mockResolvedValue({ total: 0, items: [] }),
  getIssue: vi.fn().mockResolvedValue(null),
}));

// mock github/client（详情页文件树/历史 + EditorView 判定用）
vi.mock("$lib/github/client", () => ({
  OWNER: "gaubee",
  REPO: "gaubee.com",
  BRANCH: "main",
  listCommits: vi.fn().mockResolvedValue([]),
  listContents: vi.fn().mockResolvedValue([]),
  getFileText: vi.fn().mockResolvedValue(""),
}));

// mock README 渲染
vi.mock("$lib/apps/installable/github/readme", () => ({
  fetchReadme: vi.fn().mockResolvedValue({ content: null, path: null }),
  renderReadme: vi.fn().mockReturnValue(""),
}));

// mock VFS
vi.mock("$lib/vfs/vfs.svelte", () => ({
  vfs: { dirtyFiles: vi.fn().mockResolvedValue([]) },
  vfsStore: {},
}));

// mock 活动日志
vi.mock("$lib/apps/installable/github/activity-log.svelte", () => ({
  activityLog: {
    init: vi.fn().mockResolvedValue(undefined),
    activities: [],
  },
}));

// mock 收藏 store
vi.mock("$lib/apps/installable/github/favorites.svelte", () => ({
  repoFavorites: {
    init: vi.fn().mockResolvedValue(undefined),
    items: [],
    has: vi.fn().mockReturnValue(false),
    toggle: vi.fn().mockResolvedValue(undefined),
  },
}));

// mock os/services
vi.mock("$lib/os/services", () => ({
  gaubeeos: { requestAppService: vi.fn() },
}));
vi.mock("$lib/os/services/publish-helper", () => ({
  handlePublishError: vi.fn(),
}));
vi.mock("$lib/nav/nav-controller-instance", () => ({
  navController: { navigateMain: vi.fn() },
}));
vi.mock("$lib/apps/builtin/notifications/service.svelte", () => ({
  notifySuccess: vi.fn(),
  notifyWarning: vi.fn(),
}));
vi.mock("$lib/apps/builtin/account/service", () => ({
  accountService: {
    state: { loaded: true, authenticated: false, user: null, error: null },
    login: vi.fn(),
  },
}));

// mock navStore（控制 pathname 分发）
const mockPathname = vi.fn().mockReturnValue("/app/github");
vi.mock("$lib/nav/nav.svelte", () => ({
  navStore: {
    get current() {
      return { mainLocation: { pathname: mockPathname() } };
    },
  },
}));

import GithubView from "./GithubView.svelte";

describe("GithubView（路由分发器）", () => {
  it("默认路径 /app/github 渲染列表页标题", async () => {
    mockPathname.mockReturnValue("/app/github");
    const { container } = render(GithubView);
    await new Promise((r) => setTimeout(r, 100));
    const h1 = container.querySelector("h1");
    expect(h1?.textContent).toContain("Github");
  });

  it("列表页渲染搜索框", async () => {
    mockPathname.mockReturnValue("/app/github");
    const { container } = render(GithubView);
    await new Promise((r) => setTimeout(r, 100));
    const input = container.querySelector('input[placeholder*="搜索"]');
    expect(input).toBeTruthy();
  });

  it("详情页路径 /app/github/repo/{owner}/{repo} 渲染仓库标识", async () => {
    mockPathname.mockReturnValue("/app/github/repo/sveltejs/kit");
    const { container } = render(GithubView);
    await new Promise((r) => setTimeout(r, 2000));
    // 详情页顶部显示 owner/repo
    expect(container.textContent).toContain("sveltejs/kit");
  });
});
