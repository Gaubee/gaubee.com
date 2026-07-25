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
   * 修改前的原始内容快照（首次 dirty 时保存，commit/revert 后清除）。用于 diff。
   * 二进制文件为 Uint8Array。
   */
  baseContent: string | Uint8Array | null;
  /** 软删除标记：true=文件已从 ZenFS 删除，但保留 sha/origin 供 commit 构造删除项。 */
  deleted: boolean;
}

interface GaubeeMetaDB extends DBSchema {
  meta: {
    key: string;
    value: FileMeta;
  };
}

const DB_NAME = "gaubee-meta";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<GaubeeMetaDB>> | null = null;

function getDB(): Promise<IDBPDatabase<GaubeeMetaDB>> {
  if (!dbPromise) {
    dbPromise = openDB<GaubeeMetaDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta", { keyPath: "path" });
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

/**
 * 重置单例（仅测试用）：丢弃 db 连接，下次访问重建。
 * 配合 fake-indexeddb 注入新 indexedDB 实例。
 */
export function _resetMetaDbForTest(): void {
  dbPromise = null;
}
