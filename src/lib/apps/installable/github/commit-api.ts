/**
 * GithubApp commit detail API 封装。
 *
 * 获取 commit 详情（含 files diff），供 CommitDetailPanel 渲染。
 * 前端直连 api.github.com（fetchGithub），token 在前端内存。
 */
import { fetchGithub } from "$lib/auth/session.svelte";
import type { CommitInfo } from "$lib/github/client";
import { NotAuthenticatedError } from "$lib/os/services";

async function assertOk(resp: Response, context: string): Promise<void> {
  if (resp.ok) return;
  if (resp.status === 401) {
    throw new NotAuthenticatedError(`${context}失败：会话已过期，请重新登录`);
  }
  if (resp.status === 403) {
    const body = await resp.text().catch(() => "");
    if (body.includes("rate limit")) {
      throw new Error(`${context} 失败：GitHub API 限速，请登录提升额度`);
    }
    throw new NotAuthenticatedError(`${context}失败：无权限`);
  }
  throw new Error(`${context} 失败: ${resp.status}`);
}

/** commit 文件变更项。 */
export interface CommitFile {
  /** 文件路径（如 'src/app.ts'）。 */
  filename: string;
  /** 变更类型（added/removed/modified/renamed 等）。 */
  status: "added" | "removed" | "modified" | "renamed" | "copied" | "changed" | "unchanged";
  /** 新增行数。 */
  additions: number;
  /** 删除行数。 */
  deletions: number;
  /** 变更总行数。 */
  changes: number;
  /** unified diff patch 文本（文件过大时可能为 null）。 */
  patch: string | null;
  /** 文件在 GitHub 上的链接。 */
  blob_url: string;
  /** 旧文件路径（renamed 时有值）。 */
  previous_filename?: string;
}

/** commit 统计信息。 */
export interface CommitStats {
  additions: number;
  deletions: number;
  total: number;
}

/** commit 详情（含 files diff + stats）。 */
export interface CommitDetail extends CommitInfo {
  files: CommitFile[];
  stats: CommitStats | null;
  html_url: string;
}

/** GitHub commit detail API 响应（内部）。 */
interface GhCommitDetailResponse {
  sha: string;
  commit: {
    message: string;
    author?: { name: string; email?: string | null; date?: string | null } | null;
    committer?: { name: string; email?: string | null; date?: string | null } | null;
  };
  author?: { login: string; avatar_url: string } | null;
  committer?: { login: string; avatar_url: string } | null;
  parents?: { sha: string }[];
  files?: Array<{
    filename: string;
    status: string;
    additions: number;
    deletions: number;
    changes: number;
    patch?: string | null;
    blob_url: string;
    previous_filename?: string;
  }>;
  stats?: { additions: number; deletions: number; total: number } | null;
  html_url: string;
}

/**
 * 获取 commit 详情（含 files diff）。
 * GET /repos/{owner}/{repo}/commits/{sha}
 *
 * GitHub 在以下情况不返回 patch：文件变更 >300 行，或 commit 文件数 >300。
 * 此时 files[].patch 为 null，前端降级显示文件名 + 统计。
 */
export async function getCommit(owner: string, repo: string, sha: string): Promise<CommitDetail> {
  const resp = await fetchGithub(`repos/${owner}/${repo}/commits/${sha}`);
  await assertOk(resp, `getCommit(${owner}/${repo}@${sha.slice(0, 7)})`);
  const data = (await resp.json()) as GhCommitDetailResponse;

  const msg = data.commit?.message ?? "";
  const newlineIdx = msg.indexOf("\n");

  return {
    sha: data.sha,
    message: newlineIdx === -1 ? msg : msg.slice(0, newlineIdx),
    body: newlineIdx === -1 ? "" : msg.slice(newlineIdx + 1).trim(),
    author: data.commit?.author
      ? {
          name: data.commit.author.name,
          email: data.commit.author.email ?? null,
          date: data.commit.author.date ?? null,
        }
      : null,
    committer: data.commit?.committer
      ? {
          name: data.commit.committer.name,
          email: data.commit.committer.email ?? null,
          date: data.commit.committer.date ?? null,
        }
      : null,
    avatarUrl: data.author?.avatar_url ?? data.committer?.avatar_url ?? null,
    login: data.author?.login ?? data.committer?.login ?? null,
    parents: (data.parents ?? []).map((p) => p.sha),
    files: (data.files ?? []).map((f) => ({
      filename: f.filename,
      status: f.status as CommitFile["status"],
      additions: f.additions,
      deletions: f.deletions,
      changes: f.changes,
      patch: f.patch ?? null,
      blob_url: f.blob_url,
      previous_filename: f.previous_filename,
    })),
    stats: data.stats ?? null,
    html_url: data.html_url,
  };
}
