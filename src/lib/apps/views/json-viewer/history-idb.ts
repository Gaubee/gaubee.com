/**
 * 历史记录的 IndexedDB 数据层（基于项目已有的 idb 包，VFS 同款依赖）。
 *
 * schema：DB `gaubee:json-viewer`，store `history`（keyPath 'id'）。
 * 每条历史一个 record（支持 10MB 单条；避免单巨型 value 的读写放大），
 * 淘汰/去重按 id 删记录。
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

import type { AsyncHistoryStorage, JsonHistoryItem } from "./history";

interface JsonViewerDB extends DBSchema {
  history: {
    key: string;
    value: JsonHistoryItem;
  };
}

const DB_NAME = "gaubee:json-viewer";
const STORE_NAME = "history";

let dbPromise: Promise<IDBPDatabase<JsonViewerDB>> | null = null;

function getDB(): Promise<IDBPDatabase<JsonViewerDB>> {
  dbPromise ??= openDB<JsonViewerDB>(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    },
  });
  return dbPromise;
}

/** 创建 AsyncHistoryStorage 的 IndexedDB 实现。 */
export function createIdbHistoryStorage(): AsyncHistoryStorage {
  return {
    async getAll(): Promise<JsonHistoryItem[]> {
      const db = await getDB();
      return db.getAll(STORE_NAME);
    },
    async put(item: JsonHistoryItem): Promise<void> {
      const db = await getDB();
      await db.put(STORE_NAME, item);
    },
    async delete(id: string): Promise<void> {
      const db = await getDB();
      await db.delete(STORE_NAME, id);
    },
    async clear(): Promise<void> {
      const db = await getDB();
      await db.clear(STORE_NAME);
    },
  };
}
