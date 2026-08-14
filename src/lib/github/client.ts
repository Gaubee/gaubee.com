/**
 * GitHub 客户端：封装对仓库文件的读写操作 + 只读 REST API 浏览。
 *
 * 前端直连 api.github.com（fetchGithub），token 在前端内存（authStore $state）。
 * 有 token：任意仓库可读写（权限由 token scope 决定）。
 * 无 token：匿名请求（公开仓库可读，受 60/h 限速）。
 *
 * 仓库：gaubee/gaubee.com（OWNER/REPO 常量，写作/提交主路径）。
 * 内容路径：src/content/articles、src/content/events。
 */
import { fetchGithub } from "$lib/auth/session.svelte";
import type { Collection } from "$lib/data/frontmatter";
import { NotAuthenticatedError } from "$lib/os/services";

export const OWNER = "gaubee";
export const REPO = "gaubee.com";
export const BRANCH = "main";

/**
 * 统一 HTTP 响应检查。
 * - 401 → NotAuthenticatedError（明确未认证 / 会话过期），下游引导重新登录。
 * - 403 → 读响应体判断：rate limit 抛带提示的普通 Error（非鉴权问题）；
 *   其它 403（权限不足）抛 NotAuthenticatedError。
 * - 其它非 ok → 抛带 status 的 Error。
 *
 * 注意：公开仓库的匿名 GET 会触发 GitHub 60/h rate limit，返回 403 —— 这不是
 * 鉴权失败，不应引导登录。只有真正的鉴权失败（401 或非限速的 403）才映射。
 */
async function assertOk(resp: Response, context: string): Promise<void> {
  if (resp.ok) return;
  if (resp.status === 401) {
    throw new NotAuthenticatedError(`${context}失败：会话已过期，请重新登录`);
  }
  if (resp.status === 403) {
    // rate limit 的 403 不是鉴权问题，抛普通错误提示限速
    const body = await resp.text().catch(() => "");
    if (body.includes("rate limit")) {
      throw new Error(`${context} 失败：GitHub API 限速（匿名 60/h），请登录提升额度`);
    }
    throw new NotAuthenticatedError(`${context}失败：无权限，可能需要登录`);
  }
  throw new Error(`${context} 失败: ${resp.status}`);
}

/** GitHub Content API 返回的目录/文件项。 */
export interface GhContentEntry {
  type: "file" | "dir" | "symlink" | "submodule";
  size: number;
  name: string;
  path: string;
  sha: string;
}

/** 仓库定位参数（默认指向 gaubee/gaubee.com，向后兼容）。 */
export interface RepoRef {
  owner?: string;
  repo?: string;
  /** Git ref（分支名/commit SHA/tag）。默认 BRANCH（"main"）。传 commit SHA 可查看历史版本。 */
  ref?: string;
}

function resolveRepo(ref?: RepoRef): { owner: string; repo: string; ref: string } {
  return { owner: ref?.owner ?? OWNER, repo: ref?.repo ?? REPO, ref: ref?.ref ?? BRANCH };
}

/** GitHub Commits API 返回的 commit 摘要（listCommits 用）。 */
export interface CommitInfo {
  sha: string;
  /** commit message 第一行（标题）。 */
  message: string;
  /** 完整 commit message（含正文）。 */
  body: string;
  author: {
    name: string;
    email: string | null;
    /** 提交时间（ISO 字符串，可能是 null）。 */
    date: string | null;
  } | null;
  committer: {
    name: string;
    email: string | null;
    date: string | null;
  } | null;
  /** 作者头像（取自 GitHub author，匿名提交可能缺失）。 */
  avatarUrl: string | null;
  /** 提交者 GitHub login（匿名可能缺失）。 */
  login: string | null;
  parents: string[];
}

interface GhCommitResponse {
  sha: string;
  commit: {
    message: string;
    author?: { name: string; email?: string | null; date?: string | null } | null;
    committer?: { name: string; email?: string | null; date?: string | null } | null;
  };
  author?: { login: string; avatar_url: string } | null;
  committer?: { login: string; avatar_url: string } | null;
  parents?: { sha: string }[];
}

function toCommitInfo(c: GhCommitResponse): CommitInfo {
  const msg = c.commit?.message ?? "";
  const newlineIdx = msg.indexOf("\n");
  return {
    sha: c.sha,
    message: newlineIdx === -1 ? msg : msg.slice(0, newlineIdx),
    body: newlineIdx === -1 ? "" : msg.slice(newlineIdx + 1).trim(),
    author: c.commit?.author
      ? {
          name: c.commit.author.name,
          email: c.commit.author.email ?? null,
          date: c.commit.author.date ?? null,
        }
      : null,
    committer: c.commit?.committer
      ? {
          name: c.commit.committer.name,
          email: c.commit.committer.email ?? null,
          date: c.commit.committer.date ?? null,
        }
      : null,
    avatarUrl: c.author?.avatar_url ?? c.committer?.avatar_url ?? null,
    login: c.author?.login ?? c.committer?.login ?? null,
    parents: (c.parents ?? []).map((p) => p.sha),
  };
}

/**
 * 列出仓库的提交历史（GitHub REST API: GET /repos/{owner}/{repo}/commits）。
 *
 * @param opts 可选：仓库定位（默认 gaubee/gaubee.com）、分支/ref、分页（perPage/page）、
 *             路径前缀（只看某文件/目录的历史）、作者 login 过滤。
 * @returns CommitInfo 数组（最新在前）。
 */
export async function listCommits(
  opts: RepoRef & {
    /** ref 或分支名，默认 BRANCH。 */
    sha?: string;
    /** 每页数量，默认 30，最大 100。 */
    perPage?: number;
    /** 页码，默认 1。 */
    page?: number;
    /** 仅列该路径的历史。 */
    path?: string;
    /** 按 GitHub login 过滤作者。 */
    author?: string;
    /** 仅返回此时间之后的提交（ISO 8601，如 2026-06-01T00:00:00Z）。 */
    since?: string;
    /** 仅返回此时间之前的提交（ISO 8601）。 */
    until?: string;
  } = {},
): Promise<CommitInfo[]> {
  const { owner, repo } = resolveRepo(opts);
  const params = new URLSearchParams();
  params.set("sha", opts.sha ?? BRANCH);
  params.set("per_page", String(opts.perPage ?? 30));
  params.set("page", String(opts.page ?? 1));
  if (opts.path) params.set("path", opts.path);
  if (opts.author) params.set("author", opts.author);
  if (opts.since) params.set("since", opts.since);
  if (opts.until) params.set("until", opts.until);
  const resp = await fetchGithub(`repos/${owner}/${repo}/commits?${params.toString()}`);
  if (!resp.ok) {
    if (resp.status === 404) return [];
    await assertOk(resp, `listCommits(${owner}/${repo})`);
  }
  const data = (await resp.json()) as GhCommitResponse[];
  return data.map(toCommitInfo);
}

/** GitHub Content API 返回的文件内容（base64）。 */
export interface GhFileContent {
  type: "file";
  encoding: "base64";
  content: string;
  name: string;
  path: string;
  sha: string;
  size: number;
}

function b64decode(b64: string): string {
  // GitHub 返回的 base64 可能含换行，先清掉
  const clean = b64.replace(/\n/g, "");
  const bytes = Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

function b64encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/**
 * 列出目录内容。path 为仓库内相对路径（如 'src/content/articles'）。
 * @param ref 可选仓库定位（默认 gaubee/gaubee.com，向后兼容）。
 */
export async function listContents(path: string, ref?: RepoRef): Promise<GhContentEntry[]> {
  const resolved = resolveRepo(ref);
  const resp = await fetchGithub(
    `repos/${resolved.owner}/${resolved.repo}/contents/${path}?ref=${resolved.ref}`,
  );
  if (!resp.ok) {
    if (resp.status === 404) return [];
    await assertOk(resp, `listContents(${path})`);
  }
  const data = (await resp.json()) as GhContentEntry[] | GhFileContent;
  if (Array.isArray(data)) return data;
  return [];
}

/** 读取文件文本内容。@param ref 可选仓库定位（含 ref 字段可按 commit SHA 访问历史版本）。 */
export async function getFileText(path: string, ref?: RepoRef): Promise<string> {
  const resolved = resolveRepo(ref);
  const resp = await fetchGithub(
    `repos/${resolved.owner}/${resolved.repo}/contents/${path}?ref=${resolved.ref}`,
  );
  await assertOk(resp, `getFileText(${path})`);
  const data = (await resp.json()) as GhFileContent;
  if (data.type !== "file" || data.encoding !== "base64") {
    throw new Error(`getFileText(${path}): 非文本文件或编码异常`);
  }
  return b64decode(data.content);
}

/** 读取文件文本 + sha（用于在线编辑的乐观锁写入）。
 *  与 getFileText 区别：返回 sha 字段，raw 模式编辑保存时必填。
 *  @param ref 可选仓库定位（含 ref 字段可按 commit SHA 访问历史版本）。 */
export async function getFileWithSha(
  path: string,
  ref?: RepoRef,
): Promise<{ content: string; sha: string }> {
  const resolved = resolveRepo(ref);
  const resp = await fetchGithub(
    `repos/${resolved.owner}/${resolved.repo}/contents/${path}?ref=${resolved.ref}`,
  );
  await assertOk(resp, `getFileWithSha(${path})`);
  const data = (await resp.json()) as GhFileContent;
  if (data.type !== "file" || data.encoding !== "base64") {
    throw new Error(`getFileWithSha(${path}): 非文本文件或编码异常`);
  }
  return { content: b64decode(data.content), sha: data.sha };
}

/** 更新或新建文件内容（GitHub Contents API PUT）。
 *  适用于任意仓库的在线编辑（raw 模式），绕过 vfsStore 的单仓库限制。
 *  @param sha 乐观锁：更新已有文件必填（从 getFileWithSha 取）；新建文件不传
 *  @returns 新 commit sha
 *  GitHub 端点：PUT /repos/{owner}/{repo}/contents/{path} */
export async function updateFileContent(
  path: string,
  content: string,
  opts: { owner: string; repo: string; branch?: string; sha?: string | null; message: string },
): Promise<string> {
  const { owner, repo, branch, sha, message } = opts;
  const body: Record<string, string> = {
    message,
    content: b64encode(content),
  };
  if (branch) body.branch = branch;
  if (sha) body.sha = sha;
  const resp = await fetchGithub(`repos/${owner}/${repo}/contents/${path}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  await assertOk(resp, `updateFileContent(${owner}/${repo}/${path})`);
  const data = (await resp.json()) as { commit: { sha: string } };
  return data.commit.sha;
}

/** 列出集合（articles/events）下所有 markdown 文件条目。 */
export async function listCollectionFiles(collection: Collection): Promise<GhContentEntry[]> {
  const entries = await listContents(`src/content/${collection}`);
  return entries.filter((e) => e.type === "file" && e.name.endsWith(".md"));
}

/** 递归列出目录下所有文件（用于文件树浏览）。 */
export async function listAllFiles(path: string, maxDepth = 4): Promise<GhContentEntry[]> {
  const result: GhContentEntry[] = [];
  async function walk(dir: string, depth: number) {
    if (depth > maxDepth) return;
    const entries = await listContents(dir);
    for (const entry of entries) {
      if (entry.type === "file") {
        result.push(entry);
      } else if (entry.type === "dir") {
        await walk(entry.path, depth + 1);
      }
    }
  }
  await walk(path, 0);
  return result;
}

/**
 * Trees API 递归列文件：一次请求拿到整棵子树的所有 blob（含 sha）。
 * 比 listAllFiles（逐目录递归，N 次请求）高效得多。
 * 返回的 path 是相对于仓库根的完整路径。
 */
export interface GhTreeEntry {
  path: string;
  mode: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
}

/**
 * @param ref 可选仓库定位（默认 gaubee/gaubee.com）。
 */
export async function fetchTree(
  subtree?: string,
  ref?: RepoRef,
): Promise<{ tree: GhTreeEntry[]; sha: string; truncated: boolean }> {
  const resolved = resolveRepo(ref);
  const resp = await fetchGithub(
    `repos/${resolved.owner}/${resolved.repo}/git/trees/${resolved.ref}?recursive=1`,
  );
  await assertOk(resp, "fetchTree");
  const data = (await resp.json()) as {
    tree: GhTreeEntry[];
    sha: string;
    truncated: boolean;
  };
  if (subtree) {
    const prefix = subtree.endsWith("/") ? subtree : `${subtree}/`;
    data.tree = data.tree.filter((e) => e.path === subtree || e.path.startsWith(prefix));
  }
  return data;
}

export interface StagedChange {
  /** 仓库内路径，如 'src/content/articles/0057.tc39-signals.md'。 */
  path: string;
  /** 新内容。删除时为 null。
   *  - encoding='utf-8'（默认）：UTF-8 文本字符串
   *  - encoding='base64'：纯 base64 字符串（无 data: 前缀），用于二进制文件（图片等） */
  content: string | null;
  /**
   * 远程已有文件的 blob sha（删除时必填；修改时可选，但提供可减少 blob 创建）。
   * 新建文件为 null/undefined。
   */
  sha?: string | null;
  /** 内容编码。默认 'utf-8'。
   *  - 'utf-8'：content 为 UTF-8 文本，直接进 tree item content 字段
   *  - 'base64'：content 为 base64 字符串，需先经 createBlob 上传拿 blob sha，tree item 只带 sha */
  encoding?: "utf-8" | "base64";
}

/**
 * 创建一个 git blob（Git Data API）。
 * 用于提交二进制内容（图片等）：content 为纯 base64 字符串，encoding='base64'。
 * 文本内容通常不需要单独建 blob（直接在 tree item 里带 content 即可）。
 *
 * GitHub 端点：POST /repos/{owner}/{repo}/git/blobs
 * @returns 新建 blob 的 sha
 */
export async function createBlob(
  content: string,
  encoding: "utf-8" | "base64",
  opts: { owner?: string; repo?: string } = {},
): Promise<string> {
  const { owner = OWNER, repo = REPO } = opts;
  const resp = await fetchGithub(`repos/${owner}/${repo}/git/blobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, encoding }),
  });
  await assertOk(resp, "createBlob");
  const data = (await resp.json()) as { sha: string };
  return data.sha;
}

/**
 * 批量提交变更到 GitHub（Git Data API: tree → commit → updateRef）。
 * 前端直连 api.github.com（fetchGithub）。返回新 commit sha。
 *
 * 删除文件：在 tree 里显式提供 { path, mode, type, sha: null }，
 * GitHub 会从 base_tree 移除该 path（这是 Trees API 删除文件的正确语义）。
 */
export async function commitChanges(
  message: string,
  changes: StagedChange[],
  opts: { owner?: string; repo?: string; branch?: string } = {},
): Promise<string> {
  const { owner = OWNER, repo = REPO, branch = BRANCH } = opts;
  // 1. 获取分支最新 commit 与 tree
  const refResp = await fetchGithub(`repos/${owner}/${repo}/git/refs/heads/${branch}`);
  await assertOk(refResp, "获取 ref");
  const refData = (await refResp.json()) as { object: { sha: string } };
  const latestSha = refData.object.sha;

  const commitResp = await fetchGithub(`repos/${owner}/${repo}/git/commits/${latestSha}`);
  await assertOk(commitResp, "获取 commit");
  const commitData = (await commitResp.json()) as { tree: { sha: string } };
  const baseTreeSha = commitData.tree.sha;

  // 2. 构造 tree 条目
  // GitHub Trees API 语义（配合 base_tree）：
  // - { path, mode, type:'blob', content } → 新增/修改该 path（content 仅支持 UTF-8 文本）
  // - { path, mode, type:'blob', sha } → 用已有 blob sha 指定该 path 的内容
  //   （二进制/图片必须走这条路：先 createBlob 拿 sha，再在 tree 里引用）
  // - { path, mode, type:'blob', sha: null } → 从 base_tree 删除该 path
  const treeItems: Array<{
    path: string;
    mode: "100644";
    type: "blob";
    content?: string;
    sha?: string | null;
  }> = [];

  // 2a. 二进制条目（encoding='base64'）先并发 createBlob 拿 sha
  const binaryChanges = changes.filter((c) => c.content !== null && c.encoding === "base64");
  const blobShaMap = new Map<string, string>();
  if (binaryChanges.length > 0) {
    const entries = await Promise.all(
      binaryChanges.map(async (c) => {
        const sha = await createBlob(c.content as string, "base64", { owner, repo });
        return [c.path, sha] as const;
      }),
    );
    for (const [path, sha] of entries) blobShaMap.set(path, sha);
  }

  // 2b. 组装 tree items
  for (const change of changes) {
    if (change.content === null) {
      // 删除：sha: null 配合 base_tree 表示移除。要求调用方提供原 sha（VFS 会保留）。
      treeItems.push({
        path: change.path,
        mode: "100644",
        type: "blob",
        sha: null,
      });
    } else if (change.encoding === "base64") {
      // 二进制：引用 2a 步骤创建的 blob sha（不带 content）
      const blobSha = blobShaMap.get(change.path);
      if (!blobSha) {
        throw new Error(`commitChanges: 二进制条目 ${change.path} 缺少 blob sha`);
      }
      treeItems.push({
        path: change.path,
        mode: "100644",
        type: "blob",
        sha: blobSha,
      });
    } else {
      // 文本：直接在 tree 里带 content（GitHub 会自动创建 blob）
      treeItems.push({
        path: change.path,
        mode: "100644",
        type: "blob",
        content: change.content,
      });
    }
  }

  // 3. 创建 tree
  const treeResp = await fetchGithub(`repos/${owner}/${repo}/git/trees`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems }),
  });
  await assertOk(treeResp, "创建 tree");
  const treeData = (await treeResp.json()) as { sha: string };

  // 4. 创建 commit
  const newCommitResp = await fetchGithub(`repos/${owner}/${repo}/git/commits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      tree: treeData.sha,
      parents: [latestSha],
    }),
  });
  await assertOk(newCommitResp, "创建 commit");
  const newCommitData = (await newCommitResp.json()) as { sha: string };

  // 5. 更新分支引用
  const updateResp = await fetchGithub(`repos/${owner}/${repo}/git/refs/heads/${branch}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sha: newCommitData.sha }),
  });
  await assertOk(updateResp, "更新 ref");

  return newCommitData.sha;
}
