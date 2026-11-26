/**
 * 搜索应用的会话层：搜索历史、结果缓存、刷新后恢复。
 *
 * 为什么需要它：搜索改成 main 区独立应用后，应用标签常驻保活，切走再切回
 * 本来就不会丢状态；这里补的是「刷新/重开页面」后的恢复，以及跨查询的缓存，
 * 让重复查询不再打服务端。
 *
 * 存储边界：
 * - 历史记录 localStorage（长期，用户可清空）；
 * - 最近一次搜索 snapshot 用 sessionStorage（关掉标签页即失效）；
 * - 结果缓存只在内存（页面存活期间有效），避免把大对象写进存储。
 */
import type { SearchResult } from "./types";

export type SearchAppFilter = "all" | "articles" | "event";

export interface SearchSnapshot {
  query: string;
  filter: SearchAppFilter;
  results: SearchResult[];
  at: number;
}

const HISTORY_KEY = "gaubee:search:history:v1";
const SNAPSHOT_KEY = "gaubee:search:snapshot:v1";
const MAX_HISTORY = 12;
const SNAPSHOT_TTL_MS = 30 * 60_000;
const CACHE_TTL_MS = 10 * 60_000;
const MAX_CACHE_ENTRIES = 24;
const MAX_SNAPSHOT_RESULTS = 40;

interface CacheEntry {
  results: SearchResult[];
  at: number;
}

/** 内存缓存：key = `${filter}|${normalizedQuery}`。 */
const cache = new Map<string, CacheEntry>();

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function session(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function normalizeQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function loadHistory(): string[] {
  const store = storage();
  if (!store) return [];
  try {
    const parsed: unknown = JSON.parse(store.getItem(HISTORY_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .slice(0, MAX_HISTORY);
  } catch {
    return [];
  }
}

function saveHistory(history: string[]): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    // 存储满/隐私模式：历史只是便利功能，失败不打断搜索。
  }
}

/** 记录一次查询，去重后置顶。返回新的历史列表。 */
export function rememberQuery(query: string): string[] {
  const normalized = normalizeQuery(query);
  if (!normalized) return loadHistory();
  const current = loadHistory().filter((item) => item !== normalized);
  const next = [normalized, ...current].slice(0, MAX_HISTORY);
  saveHistory(next);
  return next;
}

export function forgetQuery(query: string): string[] {
  const normalized = normalizeQuery(query);
  const next = loadHistory().filter((item) => item !== normalized);
  saveHistory(next);
  return next;
}

export function clearHistory(): string[] {
  saveHistory([]);
  return [];
}

export function readSnapshot(): SearchSnapshot | null {
  const store = session();
  if (!store) return null;
  try {
    const raw = store.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SearchSnapshot>;
    if (
      typeof parsed.query !== "string" ||
      typeof parsed.at !== "number" ||
      !Array.isArray(parsed.results)
    ) {
      return null;
    }
    if (Date.now() - parsed.at > SNAPSHOT_TTL_MS) return null;
    const filter: SearchAppFilter =
      parsed.filter === "articles" || parsed.filter === "event" ? parsed.filter : "all";
    return {
      query: parsed.query,
      filter,
      results: parsed.results.slice(0, MAX_SNAPSHOT_RESULTS),
      at: parsed.at,
    };
  } catch {
    return null;
  }
}

export function writeSnapshot(
  query: string,
  filter: SearchAppFilter,
  results: SearchResult[],
): void {
  const store = session();
  if (!store) return;
  const normalized = normalizeQuery(query);
  if (!normalized) {
    try {
      store.removeItem(SNAPSHOT_KEY);
    } catch {
      // 忽略
    }
    return;
  }
  try {
    store.setItem(
      SNAPSHOT_KEY,
      JSON.stringify({
        query: normalized,
        filter,
        results: results.slice(0, MAX_SNAPSHOT_RESULTS),
        at: Date.now(),
      } satisfies SearchSnapshot),
    );
  } catch {
    // 结果可能较大；写不进去就只保留内存态。
  }
}

export function cacheKey(filter: SearchAppFilter, query: string): string {
  return `${filter}|${normalizeQuery(query)}`;
}

export function readCache(filter: SearchAppFilter, query: string): SearchResult[] | null {
  const key = cacheKey(filter, query);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  // LRU：命中后挪到末尾。
  cache.delete(key);
  cache.set(key, entry);
  return entry.results;
}

export function writeCache(filter: SearchAppFilter, query: string, results: SearchResult[]): void {
  if (!normalizeQuery(query)) return;
  const key = cacheKey(filter, query);
  cache.delete(key);
  cache.set(key, { results, at: Date.now() });
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/** 仅测试用：清空内存缓存。 */
export function resetCacheForTests(): void {
  cache.clear();
}
