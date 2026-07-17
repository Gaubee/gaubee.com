/**
 * IndexedDB 封装（idb）：虚拟文件系统存储。
 *
 * v2 schema：单一 `vfs` store，取代旧的 stagedChanges + contentCache。
 * 旧数据（v1）在升级时迁移：stagedChanges → vfs(dirty=true)，contentCache → vfs(remote)。
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

/** VFS 节点：一个文件在虚拟文件系统中的完整状态。 */
export interface VfsRecord {
  /** 规范化绝对路径，如 'src/content/articles/0057.tc39-signals.md'。 */
  path: string;
  /** 文件文本内容（删除标记时为 null）。 */
  content: string | null;
  /** 远程 blob sha（从 GitHub 拉取时记录，本地新建为 null）。 */
  sha: string | null;
  /** 来源：remote=从 GitHub 拉的，local=本地新建。 */
  origin: "remote" | "local";
  /** 有未提交修改（本地写入后置 true，commit 成功后置 false）。 */
  dirty: boolean;
  /** 修改时间戳。 */
  mtime: number;
}

interface GaubeeDB extends DBSchema {
  vfs: {
    key: string;
    value: VfsRecord;
  };
}

const DB_NAME = "gaubee-editor";
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<GaubeeDB>> | null = null;

function getDB(): Promise<IDBPDatabase<GaubeeDB>> {
  if (!dbPromise) {
    dbPromise = openDB<GaubeeDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _tx) {
        // v0→v2：删除旧 store（用 unknown 绕过 idb 的强类型约束，旧 store 名不在新 schema 里）
        const rawDb = db as unknown as {
          objectStoreNames: DOMStringList;
          deleteObjectStore: (name: string) => void;
          createObjectStore: (name: string, opts: { keyPath: string }) => unknown;
        };
        if (oldVersion < 2) {
          // 旧数据无 origin/dirty 字段，无法迁移到 vfs，直接丢弃旧 store
          if (rawDb.objectStoreNames.contains("stagedChanges")) {
            rawDb.deleteObjectStore("stagedChanges");
          }
          if (rawDb.objectStoreNames.contains("contentCache")) {
            rawDb.deleteObjectStore("contentCache");
          }
        }
        if (!rawDb.objectStoreNames.contains("vfs")) {
          rawDb.createObjectStore("vfs", { keyPath: "path" });
        }
      },
    });
  }
  return dbPromise;
}

// ---- VFS 原始 CRUD（供 vfs.ts 使用）----

export async function vfsGet(path: string): Promise<VfsRecord | undefined> {
  const db = await getDB();
  return db.get("vfs", path);
}

export async function vfsPut(record: VfsRecord): Promise<void> {
  const db = await getDB();
  await db.put("vfs", record);
}

export async function vfsDelete(path: string): Promise<void> {
  const db = await getDB();
  await db.delete("vfs", path);
}

export async function vfsAll(): Promise<VfsRecord[]> {
  const db = await getDB();
  return db.getAll("vfs");
}

export async function vfsClear(): Promise<void> {
  const db = await getDB();
  await db.clear("vfs");
}

