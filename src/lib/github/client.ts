/**
 * GitHub 客户端：封装对仓库文件的读写操作。
 *
 * 认证后通过 Worker 代理（fetchGithub，cookie httpOnce 注入 token）。
 * 所有 GitHub REST API 调用都走 /api/proxy/*，前端不接触 token。
 *
 * 仓库：gaubee/gaubee.com（OWNER/REPO 常量）。
 * 内容路径：src/content/articles、src/content/events。
 */
import { fetchGithub } from "$lib/auth/session.svelte";
import type { Collection } from "$lib/data/frontmatter";

export const OWNER = "gaubee";
export const REPO = "gaubee.com";
export const BRANCH = "main";

/** GitHub Content API 返回的目录/文件项。 */
export interface GhContentEntry {
  type: "file" | "dir" | "symlink" | "submodule";
  size: number;
  name: string;
  path: string;
  sha: string;
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

/** 列出目录内容。path 为仓库内相对路径（如 'src/content/articles'）。 */
export async function listContents(path: string): Promise<GhContentEntry[]> {
  const resp = await fetchGithub(
    `repos/${OWNER}/${REPO}/contents/${path}?ref=${BRANCH}`,
  );
  if (!resp.ok) {
    if (resp.status === 404) return [];
    throw new Error(`listContents(${path}) 失败: ${resp.status}`);
  }
  const data = (await resp.json()) as GhContentEntry[] | GhFileContent;
  if (Array.isArray(data)) return data;
  return [];
}

/** 读取文件文本内容。 */
export async function getFileText(path: string): Promise<string> {
  const resp = await fetchGithub(
    `repos/${OWNER}/${REPO}/contents/${path}?ref=${BRANCH}`,
  );
  if (!resp.ok) throw new Error(`getFileText(${path}) 失败: ${resp.status}`);
  const data = (await resp.json()) as GhFileContent;
  if (data.type !== "file" || data.encoding !== "base64") {
    throw new Error(`getFileText(${path}): 非文本文件或编码异常`);
  }
  return b64decode(data.content);
}

/** 列出集合（articles/events）下所有 markdown 文件条目。 */
export async function listCollectionFiles(
  collection: Collection,
): Promise<GhContentEntry[]> {
  const entries = await listContents(`src/content/${collection}`);
  return entries.filter((e) => e.type === "file" && e.name.endsWith(".md"));
}

/** 递归列出目录下所有文件（用于文件树浏览）。 */
export async function listAllFiles(
  path: string,
  maxDepth = 4,
): Promise<GhContentEntry[]> {
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

export async function fetchTree(
  subtree?: string,
): Promise<{ tree: GhTreeEntry[]; sha: string; truncated: boolean }> {
  const subtreeParam = subtree ? `?recursive=1` : `?recursive=1`;
  void subtreeParam;
  const resp = await fetchGithub(
    `repos/${OWNER}/${REPO}/git/trees/${BRANCH}?recursive=1`,
  );
  if (!resp.ok) throw new Error(`fetchTree 失败: ${resp.status}`);
  const data = (await resp.json()) as {
    tree: GhTreeEntry[];
    sha: string;
    truncated: boolean;
  };
  if (subtree) {
    const prefix = subtree.endsWith("/") ? subtree : `${subtree}/`;
    data.tree = data.tree.filter(
      (e) => e.path === subtree || e.path.startsWith(prefix),
    );
  }
  return data;
}

export interface StagedChange {
  /** 仓库内路径，如 'src/content/articles/0057.tc39-signals.md'。 */
  path: string;
  /** 新内容（UTF-8 文本）。删除时为 null。 */
  content: string | null;
  /**
   * 远程已有文件的 blob sha（删除时必填；修改时可选，但提供可减少 blob 创建）。
   * 新建文件为 null/undefined。
   */
  sha?: string | null;
}

/**
 * 批量提交变更到 GitHub（Git Data API: tree → commit → updateRef）。
 * 走 Worker 代理。返回新 commit sha。
 *
 * 删除文件：在 tree 里显式提供 { path, mode, type, sha: null }，
 * GitHub 会从 base_tree 移除该 path（这是 Trees API 删除文件的正确语义）。
 */
export async function commitChanges(
  message: string,
  changes: StagedChange[],
  branch: string = BRANCH,
): Promise<string> {
  // 1. 获取分支最新 commit 与 tree
  const refResp = await fetchGithub(
    `repos/${OWNER}/${REPO}/git/refs/heads/${branch}`,
  );
  if (!refResp.ok) throw new Error(`获取 ref 失败: ${refResp.status}`);
  const refData = (await refResp.json()) as { object: { sha: string } };
  const latestSha = refData.object.sha;

  const commitResp = await fetchGithub(
    `repos/${OWNER}/${REPO}/git/commits/${latestSha}`,
  );
  if (!commitResp.ok) throw new Error(`获取 commit 失败: ${commitResp.status}`);
  const commitData = (await commitResp.json()) as { tree: { sha: string } };
  const baseTreeSha = commitData.tree.sha;

  // 2. 构造 tree 条目
  // GitHub Trees API 语义（配合 base_tree）：
  // - { path, mode, type:'blob', content } → 新增/修改该 path 的内容
  // - { path, mode, type:'blob', sha: null } → 从 base_tree 删除该 path
  const treeItems: Array<{
    path: string;
    mode: "100644";
    type: "blob";
    content?: string;
    sha?: string | null;
  }> = [];
  for (const change of changes) {
    if (change.content === null) {
      // 删除：sha: null 配合 base_tree 表示移除。要求调用方提供原 sha（VFS 会保留）。
      treeItems.push({
        path: change.path,
        mode: "100644",
        type: "blob",
        sha: null,
      });
    } else {
      // 新增/修改：直接在 tree 里带 content（GitHub 会自动创建 blob）
      treeItems.push({
        path: change.path,
        mode: "100644",
        type: "blob",
        content: change.content,
      });
    }
  }

  // 3. 创建 tree
  const treeResp = await fetchGithub(`repos/${OWNER}/${REPO}/git/trees`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems }),
  });
  if (!treeResp.ok) throw new Error(`创建 tree 失败: ${treeResp.status}`);
  const treeData = (await treeResp.json()) as { sha: string };

  // 4. 创建 commit
  const newCommitResp = await fetchGithub(
    `repos/${OWNER}/${REPO}/git/commits`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        tree: treeData.sha,
        parents: [latestSha],
      }),
    },
  );
  if (!newCommitResp.ok)
    throw new Error(`创建 commit 失败: ${newCommitResp.status}`);
  const newCommitData = (await newCommitResp.json()) as { sha: string };

  // 5. 更新分支引用
  const updateResp = await fetchGithub(
    `repos/${OWNER}/${REPO}/git/refs/heads/${branch}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sha: newCommitData.sha }),
    },
  );
  if (!updateResp.ok) throw new Error(`更新 ref 失败: ${updateResp.status}`);

  return newCommitData.sha;
}
