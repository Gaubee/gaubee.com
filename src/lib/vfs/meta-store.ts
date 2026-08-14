/**
 * VFS 元数据 sidecar 存储（IndexedDB）。
 *
 * 设计目标：
 * - ZenFS 接管文件内容存储（Uint8Array/string），本 store 只存「业务元数据」：
 *   sha / origin / dirty / baseContent / mtime / deleted。
 * - 保留 VFS 的领域语义：dirty 跟踪、sha 比对、三层读取、软删除（content=null 仍记 sha）、commit。
 * - 路径键与 ZenFS 的「仓库相对路径」对齐（不含 /workspace 前缀）。
 *
 * v2 schema：独立 db「gaubee-meta」单一 `meta` store。
 * 旧的 gaubee-editor/vfs store（含 content 字段）由 db.ts 提供，迁移后不再使用，
 * 旧数据无 origin/dirty 元信息无法迁移，直接弃用（首次使用本 store 时为空）。
 *
 * v3 schema：新增 `activities` store（GithubApp 活动日志中心，记录 commit/sync/revert）。
 *
 * v4 schema：新增 `repo_favorites` store（GithubApp 仓库收藏，列表页首页聚合卡片用）。
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

/** 文件业务元数据（不含内容，内容由 ZenFS 管）。 */
export interface FileMeta {
  /** 规范化仓库相对路径，如 'src/content/articles/0057.tc39-signals.md'。 */
  path: string;
  /** 远程 blob sha（GitHub 拉取时记录，本地新建为 null）。 */
  sha: string | null;
  /** 来源：remote=从 GitHub 拉的，local=本地新建。 */
  origin: "remote" | "local";
  /** 有未提交修改（本地写入后置 true，commit 成功后置 false）。 */
  dirty: boolean;
  /** 修改时间戳。 */
  mtime: number;
  /**
   * 修改后的原始内容快照（首次 dirty 时保存，commit/revert 后清除）。用于 diff。
   * 二进制文件为 Uint8Array。
   */
  baseContent: string | Uint8Array | null;
  /** 软删除标记：true=文件已从 ZenFS 删除，但保留 sha/origin 供 commit 构造删除项。 */
  deleted: boolean;
}

/** 已克隆仓库的管理记录（GithubApp 多仓库管理）。 */
export interface ManagedRepo {
  /** 唯一标识：owner/repo（如 "gaubee/gaubee.com"）。 */
  id: string;
  owner: string;
  repo: string;
  branch: string;
  /** ZenFS 路径（如 /repos/gaubee/gaubee.com）。 */
  dir: string;
  /** 是否浅克隆。 */
  shallow: boolean;
  /** clone 时间戳。 */
  clonedAt: number;
}

/**
 * Git 活动日志条目（GithubApp 活动日志中心）。
 * 记录各 App 的 git 操作（commit/sync/revert），供「日志」Tab 展示与审计。
 */
export interface GitActivity {
  /** 唯一 ID（timestamp + 随机后缀）。 */
  id: string;
  /** 发生时间（ms epoch）。 */
  timestamp: number;
  /** 操作类型。 */
  action: "commit" | "sync" | "revert";
  /** 发起者标识（callerId，如 'github' / 'writer' / 'publish'）。 */
  actor: string;
  /** 目标仓库（owner/repo，如 "gaubee/gaubee.com"）。 */
  repo: string;
  /** 详情：commit message / sha / 影响的文件列表等。 */
  details: {
    /** commit message（action=commit 时）。 */
    message?: string;
    /** 产生或回退到的 commit sha（commit/revert 时）。 */
    sha?: string;
    /** 影响的文件路径列表。 */
    files?: string[];
  };
}

/**
 * 仓库收藏记录（GithubApp 列表页首页聚合卡片用）。
 * 只存 owner/repo 身份标识，元数据（star/description 等）在渲染时实时从 GitHub 拉。
 */
export interface RepoFavorite {
  /** 唯一标识：owner/repo（如 "gaubee/gaubee.com"）。 */
  id: string;
  owner: string;
  repo: string;
  /** 收藏时间戳（用于排序）。 */
  favoritedAt: number;
}

/**
 * 评论草稿（GithubApp Issues 评论编辑器自动保存）。
 * key 格式：`${owner}/${repo}#${issueNumber}`（新评论）或 `comment-${commentId}`（编辑）。
 */
export interface CommentDraft {
  /** 草稿 key（issue 或 comment 标识）。 */
  key: string;
  /** 草稿内容（markdown 原文）。 */
  body: string;
  /** 更新时间戳。 */
  updatedAt: number;
}

// =========================================================================
// GithubEditorApp v6 stores（双文件夹 VFS + 最近打开仓库）
// =========================================================================

/**
 * GithubEditor 本地层文件元数据（用户编辑的未提交文件）。
 * id 格式：`{owner}/{repo}/{path}`（仓库隔离）。
 * 与旧 meta store 的区别：带 owner/repo 前缀，支持多仓库。
 */
export interface EditorFileMeta {
  /** `{owner}/{repo}/{path}`（全局唯一）。 */
  id: string;
  owner: string;
  repo: string;
  /** 仓库内相对路径（如 src/lib/x.ts）。 */
  path: string;
  /** 远程原始 sha（用于 diff + 提交乐观锁；新建文件为 null）。 */
  sha: string | null;
  /** 本地内容（未提交，内存 + IndexedDB 双写）。
   *  - encoding='utf-8'（默认）：UTF-8 文本字符串
   *  - encoding='base64'：纯 base64 字符串（无 data: 前缀），用于二进制文件（图片等） */
  content: string;
  /** 内容编码。默认 'utf-8'。'base64' 用于二进制文件（content 存纯 base64）。 */
  encoding?: "utf-8" | "base64";
  /** 是否标记删除（软删除，提交时真正删除）。 */
  deleted: boolean;
  /** 最后修改时间戳。 */
  mtime: number;
}

/**
 * GithubEditor 远程缓存（fileTree-json + commit-hash 隔离）。
 * id 格式：`{owner}/{repo}@{commitSha}`。
 * 用于 diff 计算（local vs remote）+ 文件树数据源 + 刷新检测。
 */
export interface EditorRemoteCache {
  /** `{owner}/{repo}@{commitSha}`。 */
  id: string;
  owner: string;
  repo: string;
  /** 缓存对应的 commit SHA（刷新时比对分支 HEAD，不一致则失效）。 */
  commitSha: string;
  /** 分支名（缓存时记录，用于刷新）。 */
  branch: string;
  /** 完整 blob 清单（fetchTree 一次拿到，含所有文件路径 + sha）。 */
  blobs: Array<{ path: string; sha: string; mode: string; type: string }>;
  /** 缓存时间戳（LRU 淘汰用）。 */
  cachedAt: number;
}

/**
 * GithubEditor 最近打开仓库（首页底部列表）。
 * 按 openedAt 倒序，上限 ~20 条。
 */
export interface RecentRepo {
  /** `{owner}/{repo}`。 */
  id: string;
  owner: string;
  repo: string;
  /** 最后打开时间戳。 */
  openedAt: number;
  /** 上次打开的分支（可选，方便恢复）。 */
  branch?: string;
  /** 上次打开的文件路径（可选）。 */
  path?: string;
}

interface GaubeeMetaDB extends DBSchema {
  meta: {
    key: string;
    value: FileMeta;
  };
  repos: {
    key: string;
    value: ManagedRepo;
  };
  activities: {
    key: string;
    value: GitActivity;
  };
  repo_favorites: {
    key: string;
    value: RepoFavorite;
  };
  comment_drafts: {
    key: string;
    value: CommentDraft;
  };
  // v6: GithubEditor stores
  editor_local_meta: {
    key: string;
    value: EditorFileMeta;
  };
  editor_remote_cache: {
    key: string;
    value: EditorRemoteCache;
  };
  editor_recent_repos: {
    key: string;
    value: RecentRepo;
  };
}

const DB_NAME = "gaubee-meta";
const DB_VERSION = 6;

let dbPromise: Promise<IDBPDatabase<GaubeeMetaDB>> | null = null;

function getDB(): Promise<IDBPDatabase<GaubeeMetaDB>> {
  if (!dbPromise) {
    dbPromise = openDB<GaubeeMetaDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "path" });
        }
        // v2: 加 repos store（GithubApp 多仓库管理）
        if (!db.objectStoreNames.contains("repos")) {
          db.createObjectStore("repos", { keyPath: "id" });
        }
        // v3: 加 activities store（GithubApp 活动日志中心）
        if (!db.objectStoreNames.contains("activities")) {
          db.createObjectStore("activities", { keyPath: "id" });
        }
        // v4: 加 repo_favorites store（GithubApp 仓库收藏）
        if (!db.objectStoreNames.contains("repo_favorites")) {
          db.createObjectStore("repo_favorites", { keyPath: "id" });
        }
        // v5: 加 comment_drafts store（GithubApp 评论草稿自动保存）
        if (!db.objectStoreNames.contains("comment_drafts")) {
          db.createObjectStore("comment_drafts", { keyPath: "key" });
        }
        // v6: GithubEditor stores（双文件夹 VFS + 最近打开）
        if (!db.objectStoreNames.contains("editor_local_meta")) {
          db.createObjectStore("editor_local_meta", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("editor_remote_cache")) {
          db.createObjectStore("editor_remote_cache", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("editor_recent_repos")) {
          db.createObjectStore("editor_recent_repos", { keyPath: "id" });
        }
      },
    });
  }
  return dbPromise;
}

// ---- 元数据 CRUD ----

export async function metaGet(path: string): Promise<FileMeta | undefined> {
  const db = await getDB();
  return db.get("meta", path);
}

export async function metaPut(meta: FileMeta): Promise<void> {
  const db = await getDB();
  await db.put("meta", meta);
}

export async function metaDelete(path: string): Promise<void> {
  const db = await getDB();
  await db.delete("meta", path);
}

export async function metaAll(): Promise<FileMeta[]> {
  const db = await getDB();
  return db.getAll("meta");
}

export async function metaClear(): Promise<void> {
  const db = await getDB();
  await db.clear("meta");
}

// ---- 已克隆仓库 CRUD（GithubApp 多仓库管理）----

export async function repoGet(id: string): Promise<ManagedRepo | undefined> {
  const db = await getDB();
  return db.get("repos", id);
}

export async function repoPut(repo: ManagedRepo): Promise<void> {
  const db = await getDB();
  await db.put("repos", repo);
}

export async function repoDelete(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("repos", id);
}

export async function repoAll(): Promise<ManagedRepo[]> {
  const db = await getDB();
  return db.getAll("repos");
}

// ---- 活动日志 CRUD（GithubApp 活动日志中心）----

export async function activityPut(activity: GitActivity): Promise<void> {
  const db = await getDB();
  await db.put("activities", activity);
}

export async function activityAll(): Promise<GitActivity[]> {
  const db = await getDB();
  return db.getAll("activities");
}

export async function activityClear(): Promise<void> {
  const db = await getDB();
  await db.clear("activities");
}

// ---- 仓库收藏 CRUD（GithubApp 列表页聚合卡片）----

export async function favoritePut(fav: RepoFavorite): Promise<void> {
  const db = await getDB();
  await db.put("repo_favorites", fav);
}

export async function favoriteDelete(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("repo_favorites", id);
}

export async function favoriteAll(): Promise<RepoFavorite[]> {
  const db = await getDB();
  return db.getAll("repo_favorites");
}

// ---- 评论草稿 CRUD（GithubApp 评论编辑器自动保存）----

export async function draftGet(key: string): Promise<CommentDraft | undefined> {
  const db = await getDB();
  return db.get("comment_drafts", key);
}

export async function draftPut(draft: CommentDraft): Promise<void> {
  const db = await getDB();
  await db.put("comment_drafts", draft);
}

export async function draftDelete(key: string): Promise<void> {
  const db = await getDB();
  await db.delete("comment_drafts", key);
}

// =========================================================================
// GithubEditor CRUD（editor_local_meta / editor_remote_cache / editor_recent_repos）
// =========================================================================

// ---- editor_local_meta：本地层文件元数据 ----

/** 列出某仓库的所有本地文件元数据（含已删除）。 */
export async function editorLocalAll(owner: string, repo: string): Promise<EditorFileMeta[]> {
  const db = await getDB();
  const all = await db.getAll("editor_local_meta");
  const prefix = `${owner}/${repo}/`;
  return all.filter((m) => m.id.startsWith(prefix));
}

export async function editorLocalGet(
  owner: string,
  repo: string,
  path: string,
): Promise<EditorFileMeta | undefined> {
  const db = await getDB();
  return db.get("editor_local_meta", `${owner}/${repo}/${path}`);
}

export async function editorLocalPut(meta: EditorFileMeta): Promise<void> {
  const db = await getDB();
  await db.put("editor_local_meta", meta);
}

export async function editorLocalDelete(owner: string, repo: string, path: string): Promise<void> {
  const db = await getDB();
  await db.delete("editor_local_meta", `${owner}/${repo}/${path}`);
}

/** 清空某仓库的所有本地文件（提交成功后调用）。 */
export async function editorLocalClear(owner: string, repo: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("editor_local_meta", "readwrite");
  const prefix = `${owner}/${repo}/`;
  let cursor = await tx.store.openCursor();
  while (cursor) {
    if (typeof cursor.key === "string" && cursor.key.startsWith(prefix)) {
      await cursor.delete();
    }
    cursor = await cursor.continue();
  }
  await tx.done;
}

// ---- editor_remote_cache：远程 fileTree 缓存 ----

export async function editorRemoteGet(
  owner: string,
  repo: string,
  commitSha: string,
): Promise<EditorRemoteCache | undefined> {
  const db = await getDB();
  return db.get("editor_remote_cache", `${owner}/${repo}@${commitSha}`);
}

export async function editorRemotePut(cache: EditorRemoteCache): Promise<void> {
  const db = await getDB();
  await db.put("editor_remote_cache", cache);
}

// ---- editor_recent_repos：最近打开仓库 ----

export async function recentRepoAll(): Promise<RecentRepo[]> {
  const db = await getDB();
  return db.getAll("editor_recent_repos");
}

export async function recentRepoPut(repo: RecentRepo): Promise<void> {
  const db = await getDB();
  await db.put("editor_recent_repos", repo);
}

export async function recentRepoDelete(id: string): Promise<void> {
  const db = await getDB();
  await db.delete("editor_recent_repos", id);
}

/**
 * 重置单例（仅测试用）：丢弃 db 连接，下次访问重建。
 * 配合 fake-indexeddb 注入新 indexedDB 实例。
 */
export function _resetMetaDbForTest(): void {
  dbPromise = null;
}
