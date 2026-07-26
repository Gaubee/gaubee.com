/**
 * GithubApp Issues/Comments/搜索 API 封装。
 *
 * 从 repo-api.ts 拆分 issue 相关 + 新增评论 CRUD、@mention 搜索、图片上传。
 * 前端直连 api.github.com（fetchGithub），无 Worker 代理。
 */
import { fetchGithub } from "$lib/auth/session.svelte";
import { NotAuthenticatedError } from "$lib/os/services";

/** HTTP 响应检查（与 repo-api.ts assertOk 同语义）。 */
async function assertOk(resp: Response, context: string): Promise<void> {
  if (resp.ok) return;
  if (resp.status === 401) {
    throw new NotAuthenticatedError(`${context}失败：会话已过期，请重新登录`);
  }
  if (resp.status === 403) {
    const body = await resp.text().catch(() => "");
    if (body.includes("rate limit")) {
      throw new Error(`${context} 失败：GitHub API 限速（匿名 60/h），请登录提升额度`);
    }
    throw new NotAuthenticatedError(`${context}失败：无权限，可能需要登录`);
  }
  throw new Error(`${context} 失败: ${resp.status}`);
}

// =========================================================================
// 类型定义
// =========================================================================

/** Issue 摘要（列表/搜索结果用）。 */
export interface IssueSummary {
  id: number;
  number: number;
  title: string;
  state: "open" | "closed";
  /** 是否 PR（GitHub Issues API 同时返回 PR）。 */
  pull_request?: unknown;
  user: { login: string; avatar_url: string };
  comments: number;
  created_at: string;
  updated_at: string;
  html_url: string;
  /** 标签。 */
  labels: Array<{ name: string; color: string }>;
  /** 表情反应统计（可选）。 */
  reactions?: Reactions;
}

/** Issue 详情（含正文）。 */
export interface IssueDetail extends IssueSummary {
  body: string | null;
  /** 关闭原因（state=closed 时）。 */
  state_reason?: "completed" | "not_planned" | "reopened" | "duplicate" | null;
}

/** 表情反应统计。 */
export interface Reactions {
  total_count: number;
  "+1": number;
  "-1": number;
  laugh: number;
  hooray: number;
  confused: number;
  heart: number;
  rocket: number;
  eyes: number;
  url: string;
}

/** Issue 评论。 */
export interface IssueComment {
  id: number;
  body: string | null;
  user: { login: string; avatar_url: string; html_url: string };
  created_at: string;
  updated_at: string;
  html_url: string;
  /** 作者关联（OWNER/MEMBER/COLLABORATOR/CONTRIBUTOR/NONE）。 */
  author_association: string;
  /** 表情反应（可选）。 */
  reactions?: Reactions;
}

/** 用户摘要（@mention 搜索用）。 */
export interface UserSummary {
  login: string;
  avatar_url: string;
  html_url: string;
  type: "User" | "Organization";
}

/** 代码搜索结果（#文件引用用）。 */
export interface CodeMatch {
  name: string;
  path: string;
  html_url: string;
  sha: string;
}

/** GitHub API 响应类型（内部）。 */
interface GhIssueResponse {
  id: number;
  number: number;
  title: string;
  state: "open" | "closed";
  pull_request?: unknown;
  user: { login: string; avatar_url: string };
  comments: number;
  created_at: string;
  updated_at: string;
  html_url: string;
  labels: Array<{ name: string; color: string }>;
  reactions?: Reactions;
  body?: string | null;
  state_reason?: string | null;
}

interface GhCommentResponse {
  id: number;
  body: string | null;
  user: { login: string; avatar_url: string; html_url: string };
  created_at: string;
  updated_at: string;
  html_url: string;
  author_association: string;
  reactions?: Reactions;
}

// =========================================================================
// 转换函数
// =========================================================================

function toIssueSummary(i: GhIssueResponse): IssueSummary {
  return {
    id: i.id,
    number: i.number,
    title: i.title,
    state: i.state,
    pull_request: i.pull_request,
    user: { login: i.user.login, avatar_url: i.user.avatar_url },
    comments: i.comments,
    created_at: i.created_at,
    updated_at: i.updated_at,
    html_url: i.html_url,
    labels: i.labels,
    reactions: i.reactions,
  };
}

function toIssueDetail(i: GhIssueResponse): IssueDetail {
  return {
    ...toIssueSummary(i),
    body: i.body ?? null,
    state_reason: (i.state_reason as IssueDetail["state_reason"]) ?? null,
  };
}

function toComment(c: GhCommentResponse): IssueComment {
  return {
    id: c.id,
    body: c.body,
    user: c.user,
    created_at: c.created_at,
    updated_at: c.updated_at,
    html_url: c.html_url,
    author_association: c.author_association,
    reactions: c.reactions,
  };
}

// =========================================================================
// Issue 列表/详情（从 repo-api.ts 迁移）
// =========================================================================

/**
 * 列出仓库的 issues（排除 PR）。
 * GET /repos/{owner}/{repo}/issues?state=open&per_page=N
 */
export async function listIssues(
  owner: string,
  repo: string,
  opts?: { state?: "open" | "closed" | "all"; perPage?: number; page?: number },
): Promise<IssueSummary[]> {
  const params = new URLSearchParams({
    state: opts?.state ?? "open",
    per_page: String(opts?.perPage ?? 30),
    page: String(opts?.page ?? 1),
  });
  const resp = await fetchGithub(`repos/${owner}/${repo}/issues?${params.toString()}`);
  if (resp.status === 404) return [];
  await assertOk(resp, `listIssues(${owner}/${repo})`);
  const data = (await resp.json()) as GhIssueResponse[];
  return data.filter((i) => !i.pull_request).map(toIssueSummary);
}

/**
 * 搜索仓库内 issues。
 * GET /search/issues?q={query}+repo:{owner}/{repo}+is:issue
 */
export async function searchIssues(
  owner: string,
  repo: string,
  query: string,
  opts?: { perPage?: number; page?: number },
): Promise<{ total: number; items: IssueSummary[] }> {
  const q = `${query} repo:${owner}/${repo} is:issue`;
  const params = new URLSearchParams({
    q,
    per_page: String(opts?.perPage ?? 20),
    page: String(opts?.page ?? 1),
  });
  const resp = await fetchGithub(`search/issues?${params.toString()}`);
  await assertOk(resp, `searchIssues(${owner}/${repo})`);
  const data = (await resp.json()) as { total_count: number; items: GhIssueResponse[] };
  return { total: data.total_count, items: data.items.map(toIssueSummary) };
}

/**
 * 获取单个 issue 详情。
 * GET /repos/{owner}/{repo}/issues/{number}
 */
export async function getIssue(owner: string, repo: string, number: number): Promise<IssueDetail> {
  const resp = await fetchGithub(`repos/${owner}/${repo}/issues/${number}`);
  await assertOk(resp, `getIssue(${owner}/${repo}#${number})`);
  const data = (await resp.json()) as GhIssueResponse;
  return toIssueDetail(data);
}

// =========================================================================
// 评论 CRUD（新增）
// =========================================================================

/**
 * 列出某 issue 的所有评论（按创建时间升序）。
 * GET /repos/{owner}/{repo}/issues/{number}/comments
 */
export async function listIssueComments(
  owner: string,
  repo: string,
  number: number,
  opts?: { perPage?: number; page?: number },
): Promise<IssueComment[]> {
  const params = new URLSearchParams({
    per_page: String(opts?.perPage ?? 100),
    page: String(opts?.page ?? 1),
  });
  const resp = await fetchGithub(
    `repos/${owner}/${repo}/issues/${number}/comments?${params.toString()}`,
  );
  if (resp.status === 404) return [];
  await assertOk(resp, `listIssueComments(${owner}/${repo}#${number})`);
  const data = (await resp.json()) as GhCommentResponse[];
  return data.map(toComment);
}

/**
 * 发表评论。
 * POST /repos/{owner}/{repo}/issues/{number}/comments
 * @returns 新建的评论（含 id）
 */
export async function createIssueComment(
  owner: string,
  repo: string,
  number: number,
  body: string,
): Promise<IssueComment> {
  const resp = await fetchGithub(`repos/${owner}/${repo}/issues/${number}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  await assertOk(resp, `createIssueComment(${owner}/${repo}#${number})`);
  const data = (await resp.json()) as GhCommentResponse;
  return toComment(data);
}

/**
 * 编辑评论（仅评论作者或仓库管理员）。
 * PATCH /repos/{owner}/{repo}/issues/comments/{commentId}
 */
export async function updateIssueComment(
  owner: string,
  repo: string,
  commentId: number,
  body: string,
): Promise<IssueComment> {
  const resp = await fetchGithub(`repos/${owner}/${repo}/issues/comments/${commentId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body }),
  });
  await assertOk(resp, `updateIssueComment(${owner}/${repo}#${commentId})`);
  const data = (await resp.json()) as GhCommentResponse;
  return toComment(data);
}

/**
 * 删除评论（仅评论作者或仓库管理员）。
 * DELETE /repos/{owner}/{repo}/issues/comments/{commentId}
 */
export async function deleteIssueComment(
  owner: string,
  repo: string,
  commentId: number,
): Promise<void> {
  const resp = await fetchGithub(`repos/${owner}/${repo}/issues/comments/${commentId}`, {
    method: "DELETE",
  });
  await assertOk(resp, `deleteIssueComment(${owner}/${repo}#${commentId})`);
}

// =========================================================================
// @mention / #引用 搜索（新增）
// =========================================================================

/**
 * 搜索用户（@mention 自动补全用）。
 * GET /search/users?q={query}
 */
export async function searchUsers(
  query: string,
  opts?: { perPage?: number },
): Promise<{ total: number; items: UserSummary[] }> {
  const params = new URLSearchParams({
    q: query,
    per_page: String(opts?.perPage ?? 5),
  });
  const resp = await fetchGithub(`search/users?${params.toString()}`);
  await assertOk(resp, `searchUsers(${query})`);
  const data = (await resp.json()) as {
    total_count: number;
    items: Array<{
      login: string;
      avatar_url: string;
      html_url: string;
      type: "User" | "Organization";
    }>;
  };
  return {
    total: data.total_count,
    items: data.items.map((u) => ({
      login: u.login,
      avatar_url: u.avatar_url,
      html_url: u.html_url,
      type: u.type,
    })),
  };
}

/**
 * 搜索仓库代码（#文件引用自动补全用）。
 * GET /search/code?q={query}+repo:{owner}/{repo}
 */
export async function searchCode(
  owner: string,
  repo: string,
  query: string,
  opts?: { perPage?: number },
): Promise<{ total: number; items: CodeMatch[] }> {
  const q = `${query} repo:${owner}/${repo}`;
  const params = new URLSearchParams({
    q,
    per_page: String(opts?.perPage ?? 5),
  });
  const resp = await fetchGithub(`search/code?${params.toString()}`);
  await assertOk(resp, `searchCode(${owner}/${repo})`);
  const data = (await resp.json()) as {
    total_count: number;
    items: Array<{ name: string; path: string; html_url: string; sha: string }>;
  };
  return {
    total: data.total_count,
    items: data.items.map((c) => ({
      name: c.name,
      path: c.path,
      html_url: c.html_url,
      sha: c.sha,
    })),
  };
}

// =========================================================================
// 图片上传（经 Worker，用 Contents API）
// =========================================================================

/**
 * 上传图片到仓库，返回 raw URL（用于评论 markdown 插图）。
 *
 * 走 Worker /upload/image 端点（Worker 用 token 调 Contents API PUT）。
 * 路径：`.github-issue-assets/{timestamp}-{rand}.{ext}`
 *
 * @param owner 仓库 owner
 * @param repo 仓库名
 * @param file 图片文件（前端 paste/drop 获取）
 * @returns raw URL（可直接用于 markdown ![](url)）
 */
export async function uploadIssueImage(owner: string, repo: string, file: File): Promise<string> {
  // Worker 基础 URL（与 OAuth 共用）
  const AUTH_BASE =
    (import.meta.env.VITE_AUTH_BASE as string | undefined) ?? "http://localhost:8787";
  const formData = new FormData();
  formData.append("owner", owner);
  formData.append("repo", repo);
  formData.append("file", file);

  const resp = await fetch(`${AUTH_BASE}/upload/image`, {
    method: "POST",
    body: formData,
    credentials: "include",
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`图片上传失败: ${resp.status} ${text}`);
  }
  const data = (await resp.json()) as { url: string };
  return data.url;
}
