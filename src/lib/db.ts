import { openDB, type DBSchema } from "idb";

const DB_NAME = "GaubeeAdminDB";
const STORE_NAME = "stagedChanges";
const DB_VERSION = 1;

export interface StagedChange {
  path: string; // This will be the primary key
  content?: string; // Content is optional for 'deleted' status
  originalContent?: string; // Original content for diffing 'updated' status
  status: "created" | "updated" | "deleted";
}

interface MyDB extends DBSchema {
  [STORE_NAME]: {
    key: string;
    value: StagedChange;
    indexes: { "by-status": string };
  };
}

async function getDb() {
  return openDB<MyDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const store = db.createObjectStore(STORE_NAME, {
        keyPath: "path",
      });
      store.createIndex("by-status", "status");
    },
  });
}

export async function upsertChange(change: StagedChange) {
  const db = await getDb();
  return db.put(STORE_NAME, change);
}

export async function getChange(path: string) {
  const db = await getDb();
  return db.get(STORE_NAME, path);
}

export async function getAllChanges() {
  const db = await getDb();
  return db.getAll(STORE_NAME);
}

export async function deleteChange(path: string) {
  const db = await getDb();
  await db.delete(STORE_NAME, path);
  console.log("QAQ after deleteChange", db.getAll(STORE_NAME));
}
