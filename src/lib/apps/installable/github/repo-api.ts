/**
 * GithubApp 列表页/详情页的仓库级 REST API 封装。
 *
 * 与 client.ts 的分工：
 * - client.ts：聚焦主仓库（gaubee/gaubee.com）的内容文件读写 + 提交（VFS/提交链路）。
 * - repo-api.ts：聚焦仓库发现/浏览（列表页的聚合卡片、搜索、issues），只读为主，
 *   覆盖 user/org 仓库列表、搜索、issues 等 client.ts 未覆盖的端点。
 *
 * 所有调用经 fetchGithub（Worker 代理，cookie httpOnly 注入 token）。
 */
import { fetchGithub } from "$lib/auth/session.svelte";
import { NotAuthenticatedError } from "$lib/os/services";

/** HTTP 响应检查（与 client.ts assertOk 同语义，但此处独立避免循环依赖）。 */
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

/**
 * 分页结果（list 类 API 的统一返回结构）。
 * - repos：当前页的仓库列表
 * - total：GitHub 报告的总数（来自 Link 头 last page × perPage 推算，下界）
 * - hasMore：是否有下一页（Link 头含 rel="next"）
 * - nextPage：下一页页码（hasMore 时有效）
 */
export interface RepoPage {
  repos: RepoSummary[];
  /** 总数下界（实际总数 >= total）。无 Link 头时为当前页数量。 */
  total: number;
  hasMore: boolean;
  nextPage: number | null;
}

/**
 * 从响应的 Link 头解析分页信息。
 * GitHub Link 头格式：<url?page=N>; rel="next", <url?page=M>; rel="last"
 * - rel="next" 存在 → hasMore = true
 * - rel="last" 的 page M → 总数下界 = (M-1) * perPage + 1（最后一页至少 1 个）
 */
function parsePagination(
  resp: Response,
  perPage: number,
  currentPage: number,
): {
  hasMore: boolean;
  nextPage: number | null;
  total: number;
} {
  const link = resp.headers.get("Link") ?? "";
  if (!link) {
    // 无 Link 头：单页结果，无更多
    return { hasMore: false, nextPage: null, total: 0 };
  }
  const nextMatch = link.match(/page=(\d+)>; rel="next"/);
  const lastMatch = link.match(/page=(\d+)>; rel="last"/);
  const hasMore = !!nextMatch;
  const nextPage = nextMatch ? Number(nextMatch[1]) : null;
  // 总数下界：last page 存在时 (lastPage-1)*perPage + 1；否则用当前页
  let total = 0;
  if (lastMatch) {
    const lastPage = Number(lastMatch[1]);
    total = (lastPage - 1) * perPage; // 下界（最后一页数量未知，至少 0 个，加上当前已加载）
  }
  return { hasMore, nextPage, total };
}

/** 仓库摘要（列表页/搜索结果用，裁剪自 GitHub Repo API 全量字段）。 */
export interface RepoSummary {
  id: number;
  name: string;
  /** 仓库全名 owner/repo。 */
  full_name: string;
  owner: { login: string; avatar_url: string };
  description: string | null;
  /** 语言（如 "TypeScript"）。 */
  language: string | null;
  /** star 数。 */
  stargazers_count: number;
  /** fork 数。 */
  forks_count: number;
  /** 是否已归档。 */
  archived: boolean;
  /** 默认分支。 */
  default_branch: string;
  /** 最近推送时间（ISO 字符串）。 */
  pushed_at: string;
  html_url: string;
}

interface GhRepoResponse {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string; avatar_url: string };
  description: string | null;
  language: string | null;
  stargazers_count: number;
  forks_count: number;
  archived: boolean;
  default_branch: string;
  pushed_at: string;
  html_url: string;
}

function toRepoSummary(r: GhRepoResponse): RepoSummary {
  return {
    id: r.id,
    name: r.name,
    full_name: r.full_name,
    owner: { login: r.owner.login, avatar_url: r.owner.avatar_url },
    description: r.description,
    language: r.language,
    stargazers_count: r.stargazers_count,
    forks_count: r.forks_count,
    archived: r.archived,
    default_branch: r.default_branch,
    pushed_at: r.pushed_at,
    html_url: r.html_url,
  };
}

/** 组织/用户摘要（listUserOrgs 用）。 */
export interface OrgSummary {
  login: string;
  avatar_url: string;
}

/**
 * 列出当前认证用户的仓库（按 updated 倒序）。
 * GET /user/repos?sort=updated&per_page=N
 */
/**
 * 列出当前认证用户的仓库（按 updated 倒序）。
 * GET /user/repos?sort=updated&per_page=N&page=P
 * @returns RepoPage（含分页信息，total 为下界）
 */
export async function listUserRepos(opts?: {
  sort?: "updated" | "created" | "full_name" | "pushed";
  perPage?: number;
  page?: number;
}): Promise<RepoPage> {
  const perPage = opts?.perPage ?? 10;
  const page = opts?.page ?? 1;
  const params = new URLSearchParams({
    sort: opts?.sort ?? "updated",
    per_page: String(perPage),
    page: String(page),
  });
  const resp = await fetchGithub(`user/repos?${params.toString()}`);
  if (resp.status === 404) return { repos: [], total: 0, hasMore: false, nextPage: null };
  await assertOk(resp, "listUserRepos");
  const data = (await resp.json()) as GhRepoResponse[];
  const { hasMore, nextPage, total } = parsePagination(resp, perPage, page);
  return { repos: data.map(toRepoSummary), total, hasMore, nextPage };
}

/**
 * 列出指定用户的公开仓库。
 * GET /users/{username}/repos?sort=updated&per_page=N
 */
export async function listUserPublicRepos(
  username: string,
  opts?: { sort?: string; perPage?: number; page?: number },
): Promise<RepoSummary[]> {
  const params = new URLSearchParams({
    sort: opts?.sort ?? "updated",
    per_page: String(opts?.perPage ?? 10),
    page: String(opts?.page ?? 1),
  });
  const resp = await fetchGithub(`users/${username}/repos?${params.toString()}`);
  if (resp.status === 404) return [];
  await assertOk(resp, `listUserPublicRepos(${username})`);
  const data = (await resp.json()) as GhRepoResponse[];
  return data.map(toRepoSummary);
}

/**
 * 列出指定组织的仓库。
 * GET /orgs/{org}/repos?sort=updated&per_page=N&page=P
 * @returns RepoPage（含分页信息，total 为下界）
 */
export async function listOrgRepos(
  org: string,
  opts?: { sort?: string; perPage?: number; page?: number },
): Promise<RepoPage> {
  const perPage = opts?.perPage ?? 10;
  const page = opts?.page ?? 1;
  const params = new URLSearchParams({
    sort: opts?.sort ?? "updated",
    per_page: String(perPage),
    page: String(page),
  });
  const resp = await fetchGithub(`orgs/${org}/repos?${params.toString()}`);
  if (resp.status === 404) return { repos: [], total: 0, hasMore: false, nextPage: null };
  await assertOk(resp, `listOrgRepos(${org})`);
  const data = (await resp.json()) as GhRepoResponse[];
  const { hasMore, nextPage, total } = parsePagination(resp, perPage, page);
  return { repos: data.map(toRepoSummary), total, hasMore, nextPage };
}

/**
 * 列出当前认证用户所属的组织。
 * GET /user/orgs
 */
export async function listUserOrgs(): Promise<OrgSummary[]> {
  const resp = await fetchGithub("user/orgs");
  if (resp.status === 404) return [];
  await assertOk(resp, "listUserOrgs");
  const data = (await resp.json()) as Array<{ login: string; avatar_url: string }>;
  return data.map((o) => ({ login: o.login, avatar_url: o.avatar_url }));
}

/**
 * 搜索仓库。
 * GET /search/repositories?q={query}&sort=stars&per_page=N
 * @param query 搜索关键词。调用方可拼接 GitHub 限定符（如 'react user:facebook'）。
 */
export async function searchRepos(
  query: string,
  opts?: { sort?: "stars" | "forks" | "updated"; perPage?: number; page?: number },
): Promise<{ total: number; items: RepoSummary[] }> {
  const params = new URLSearchParams({
    q: query,
    sort: opts?.sort ?? "updated",
    order: "desc",
    per_page: String(opts?.perPage ?? 20),
    page: String(opts?.page ?? 1),
  });
  const resp = await fetchGithub(`search/repositories?${params.toString()}`);
  await assertOk(resp, "searchRepos");
  const data = (await resp.json()) as { total_count: number; items: GhRepoResponse[] };
  return { total: data.total_count, items: data.items.map(toRepoSummary) };
}

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
}

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
}

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
  };
}

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
  // 排除 PR（GitHub Issues API 同时返回 PR）
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

/** Issue 详情（含正文）。 */
export interface IssueDetail extends IssueSummary {
  body: string | null;
}

/**
 * 获取单个 issue 详情。
 * GET /repos/{owner}/{repo}/issues/{number}
 */
export async function getIssue(owner: string, repo: string, number: number): Promise<IssueDetail> {
  const resp = await fetchGithub(`repos/${owner}/${repo}/issues/${number}`);
  await assertOk(resp, `getIssue(${owner}/${repo}#${number})`);
  const data = (await resp.json()) as GhIssueResponse & { body: string | null };
  return { ...toIssueSummary(data), body: data.body };
}

/**
 * 获取仓库元数据（详情页顶部展示）。
 * GET /repos/{owner}/{repo}
 */
export async function getRepo(owner: string, repo: string): Promise<RepoSummary> {
  const resp = await fetchGithub(`repos/${owner}/${repo}`);
  await assertOk(resp, `getRepo(${owner}/${repo})`);
  const data = (await resp.json()) as GhRepoResponse;
  return toRepoSummary(data);
}
