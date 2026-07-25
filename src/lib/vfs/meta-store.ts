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
}

const DB_NAME = "gaubee-meta";
const DB_VERSION = 3;

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

/**
 * 重置单例（仅测试用）：丢弃 db 连接，下次访问重建。
 * 配合 fake-indexeddb 注入新 indexedDB 实例。
 */
export function _resetMetaDbForTest(): void {
  dbPromise = null;
}
