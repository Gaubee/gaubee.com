/**
 * repo-api 单元测试（server project，纯逻辑）。
 *
 * 验证 GitHub REST API 封装的请求构造与响应解析。
 * fetchGithub 被 mock，断言调用的路径参数与返回值转换。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

// mock fetchGithub（Worker 代理入口）
const mockFetch = vi.fn();
vi.mock("$lib/auth/session.svelte", () => ({
  fetchGithub: (path: string, init?: RequestInit) => mockFetch(path, init),
}));

import {
  listUserRepos,
  listOrgRepos,
  listUserOrgs,
  searchRepos,
  listIssues,
  searchIssues,
  getIssue,
  getRepo,
  getBranch,
} from "./repo-api";

const sampleRepo = {
  id: 1,
  name: "kit",
  full_name: "sveltejs/kit",
  owner: { login: "sveltejs", avatar_url: "https://x" },
  description: "toolchain",
  language: "TypeScript",
  stargazers_count: 18000,
  forks_count: 1500,
  archived: false,
  default_branch: "main",
  pushed_at: "2026-07-01T00:00:00Z",
  html_url: "https://github.com/sveltejs/kit",
};

const sampleIssue = {
  id: 10,
  number: 42,
  title: "Bug",
  state: "open" as const,
  user: { login: "alice", avatar_url: "https://y" },
  comments: 3,
  created_at: "2026-07-01T00:00:00Z",
  updated_at: "2026-07-02T00:00:00Z",
  html_url: "https://github.com/sveltejs/kit/issues/42",
  labels: [{ name: "bug", color: "red" }],
};

function jsonResponse(data: unknown, ok = true, headers?: Record<string, string>): Response {
  return {
    ok,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
    headers: new Headers(headers),
  } as Response;
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe("repo-api", () => {
  it("listUserRepos 构造 user/repos 路径并解析", async () => {
    mockFetch.mockResolvedValue(jsonResponse([sampleRepo]));
    const page = await listUserRepos({ perPage: 5 });
    expect(mockFetch).toHaveBeenCalledOnce();
    const [path] = mockFetch.mock.calls[0];
    expect(path).toContain("user/repos");
    expect(path).toContain("per_page=5");
    expect(page.repos).toHaveLength(1);
    expect(page.repos[0].full_name).toBe("sveltejs/kit");
    expect(page.repos[0].stargazers_count).toBe(18000);
    // 无 Link 头时 hasMore=false
    expect(page.hasMore).toBe(false);
  });

  it("listOrgRepos 构造 orgs/{org}/repos 路径", async () => {
    mockFetch.mockResolvedValue(jsonResponse([sampleRepo]));
    await listOrgRepos("sveltejs");
    const [path] = mockFetch.mock.calls[0];
    expect(path).toContain("orgs/sveltejs/repos");
  });

  it("listUserRepos 解析 Link 头分页（hasMore + total 下界）", async () => {
    // 模拟 GitHub 分页响应：per_page=30，当前第 1 页，共 6 页（约 150+ 个）
    mockFetch.mockResolvedValue(
      jsonResponse([sampleRepo], true, {
        Link: '<https://api.github.com/user/repos?per_page=30&page=2>; rel="next", <https://api.github.com/user/repos?per_page=30&page=6>; rel="last"',
      }),
    );

    const page = await listUserRepos({ perPage: 30, page: 1 });
    expect(page.hasMore).toBe(true);
    expect(page.nextPage).toBe(2);
    // total 下界 = (lastPage - 1) * perPage = 5 * 30 = 150
    expect(page.total).toBe(150);
  });

  it("listUserOrgs 返回 login + avatar", async () => {
    mockFetch.mockResolvedValue(jsonResponse([{ login: "sveltejs", avatar_url: "https://z" }]));
    const orgs = await listUserOrgs();
    expect(orgs).toEqual([{ login: "sveltejs", avatar_url: "https://z" }]);
  });

  it("searchRepos 构造 search/repositories?q= 路径", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ total_count: 1, items: [sampleRepo] }));
    const result = await searchRepos("kit user:sveltejs");
    const [path] = mockFetch.mock.calls[0];
    expect(path).toContain("search/repositories");
    expect(path).toContain("q=kit+user%3Asveltejs");
    expect(result.total).toBe(1);
    expect(result.items[0].name).toBe("kit");
  });

  it("listIssues 走 search API（is:issue 自动过滤 PR）", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ total_count: 1, items: [sampleIssue] }));
    const issues = await listIssues("sveltejs", "kit");
    const [path] = mockFetch.mock.calls[0];
    // 现在走 search API（与计数数据源统一），不再走 /issues 端点
    expect(path).toContain("search/issues");
    expect(path).toContain("is%3Aopen");
    expect(path).toContain("repo%3Asveltejs%2Fkit");
    expect(issues).toHaveLength(1);
    expect(issues[0].number).toBe(42);
  });

  it("listIssues state=closed 构造 is:closed 查询", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ total_count: 0, items: [] }));
    await listIssues("sveltejs", "kit", { state: "closed" });
    const [path] = mockFetch.mock.calls[0];
    expect(path).toContain("is%3Aclosed");
  });

  it("searchIssues 构造 repo 限定符", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ total_count: 1, items: [sampleIssue] }));
    await searchIssues("sveltejs", "kit", "bug");
    const [path] = mockFetch.mock.calls[0];
    expect(path).toContain("search/issues");
    expect(path).toContain("repo%3Asveltejs%2Fkit");
    expect(path).toContain("is%3Aissue");
  });

  it("getIssue 返回含 body", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ ...sampleRepo, body: "# hi" }));
    // 用 issue 结构替代
    mockFetch.mockResolvedValue(jsonResponse({ ...sampleIssue, body: "# hello" }));
    const issue = await getIssue("sveltejs", "kit", 42);
    expect(issue.body).toBe("# hello");
    expect(issue.number).toBe(42);
  });

  it("getIssue 透传 assignees 和 milestone（null 时为空）", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        ...sampleIssue,
        assignees: [{ login: "gaubee", avatar_url: "https://x/gaubee.png" }],
        milestone: { title: "v1.0", html_url: "https://github.com/x/milestone/1" },
      }),
    );
    const issue = await getIssue("sveltejs", "kit", 42);
    expect(issue.assignees).toHaveLength(1);
    expect(issue.assignees[0].login).toBe("gaubee");
    expect(issue.milestone?.title).toBe("v1.0");
  });

  it("getIssue assignees/milestone 缺省时为 []/null", async () => {
    mockFetch.mockResolvedValue(jsonResponse(sampleIssue));
    const issue = await getIssue("sveltejs", "kit", 42);
    expect(issue.assignees).toEqual([]);
    expect(issue.milestone).toBeNull();
  });

  it("getRepo 返回仓库元数据", async () => {
    mockFetch.mockResolvedValue(jsonResponse(sampleRepo));
    const repo = await getRepo("sveltejs", "kit");
    expect(mockFetch).toHaveBeenCalledWith("repos/sveltejs/kit", undefined);
    expect(repo.full_name).toBe("sveltejs/kit");
    expect(repo.default_branch).toBe("main");
  });

  it("getRepo 透传 permissions（详情端点才返回，列表/搜索不返回）", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        ...sampleRepo,
        permissions: { admin: true, maintain: true, push: true, triage: true, pull: true },
      }),
    );
    const repo = await getRepo("sveltejs", "kit");
    expect(repo.permissions?.push).toBe(true);
    expect(repo.permissions?.admin).toBe(true);
  });

  it("getRepo permissions 缺省时为 undefined（列表端点不返回）", async () => {
    mockFetch.mockResolvedValue(jsonResponse(sampleRepo));
    const repo = await getRepo("sveltejs", "kit");
    expect(repo.permissions).toBeUndefined();
  });

  it("404 时 listIssues 返回空数组", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ total_count: 0, items: [] }),
      text: async () => "",
    } as Response);
    const issues = await listIssues("no", "exist");
    expect(issues).toEqual([]);
  });

  it("getBranch 走 branches/{branch} 路径并返回 protected 字段", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        name: "main",
        commit: { sha: "abc123" },
        protected: true,
      }),
    );
    const branch = await getBranch("sveltejs", "kit", "main");
    const [path] = mockFetch.mock.calls[0];
    expect(path).toBe("repos/sveltejs/kit/branches/main");
    expect(branch).toEqual({ name: "main", commit: { sha: "abc123" }, protected: true });
  });

  it("getBranch 对带斜线的分支名做 encodeURIComponent", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ name: "feat/x", commit: { sha: "abc" }, protected: false }),
    );
    await getBranch("o", "r", "feat/x");
    const [path] = mockFetch.mock.calls[0];
    expect(path).toBe("repos/o/r/branches/feat%2Fx");
  });

  it("getBranch 404 返回 null（分支不存在）", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
      text: async () => "",
    } as Response);
    const branch = await getBranch("o", "r", "nope");
    expect(branch).toBeNull();
  });
});
