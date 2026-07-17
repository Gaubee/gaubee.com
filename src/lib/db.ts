/**
 * IndexedDB 封装（idb）：暂存变更 + 内容缓存。
 *
 * 两个 store：
 * - stagedChanges：暂存的文件变更（path → content），未 commit 前保留。
 * - contentCache：远程拉取的文件内容缓存（path → {content, sha, fetchedAt}）。
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

interface GaubeeDB extends DBSchema {
  stagedChanges: {
    key: string // 仓库内路径
    value: {
      path: string
      content: string | null
      updatedAt: number
    }
  }
  contentCache: {
    key: string // 仓库内路径
    value: {
      path: string
      content: string
      sha: string
      fetchedAt: number
    }
  }
}

const DB_NAME = 'gaubee-editor'
const DB_VERSION = 1

let dbPromise: Promise<IDBPDatabase<GaubeeDB>> | null = null

function getDB(): Promise<IDBPDatabase<GaubeeDB>> {
  if (!dbPromise) {
    dbPromise = openDB<GaubeeDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('stagedChanges')) {
          db.createObjectStore('stagedChanges', { keyPath: 'path' })
        }
        if (!db.objectStoreNames.contains('contentCache')) {
          db.createObjectStore('contentCache', { keyPath: 'path' })
        }
      },
    })
  }
  return dbPromise
}

// ---- 暂存变更 ----

export async function stageChange(path: string, content: string | null): Promise<void> {
  const db = await getDB()
  await db.put('stagedChanges', { path, content, updatedAt: Date.now() })
}

export async function unstageChange(path: string): Promise<void> {
  const db = await getDB()
  await db.delete('stagedChanges', path)
}

export async function getStagedChange(path: string) {
  const db = await getDB()
  return db.get('stagedChanges', path)
}

export async function getAllStagedChanges() {
  const db = await getDB()
  return db.getAll('stagedChanges')
}

export async function clearStagedChanges(): Promise<void> {
  const db = await getDB()
  await db.clear('stagedChanges')
}

// ---- 内容缓存 ----

export async function getCachedContent(path: string) {
  const db = await getDB()
  return db.get('contentCache', path)
}

export async function setCachedContent(
  path: string,
  content: string,
  sha: string
): Promise<void> {
  const db = await getDB()
  await db.put('contentCache', { path, content, sha, fetchedAt: Date.now() })
}

export async function clearContentCache(): Promise<void> {
  const db = await getDB()
  await db.clear('contentCache')
}
