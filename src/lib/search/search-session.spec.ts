/**
 * 搜索会话层测试：历史去重/上限、结果缓存键隔离、刷新恢复的 TTL。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearHistory,
  forgetQuery,
  loadHistory,
  loadSortMode,
  normalizeQuery,
  readCache,
  readSnapshot,
  rememberQuery,
  resetCacheForTests,
  saveSortMode,
  writeCache,
  writeSnapshot,
} from "./search-session";
import type { SearchResult } from "./types";

/** 最小 Storage 实现：node 测试环境没有 localStorage/sessionStorage。 */
class MemoryStorage implements Storage {
  private data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

function result(id: string): SearchResult {
  return {
    id,
    appId: "articles",
    appName: "文章",
    title: id,
    excerpt: "",
    href: `/article/${id}`,
    date: 0,
    score: 1,
  };
}

beforeEach(() => {
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  vi.stubGlobal("window", { localStorage, sessionStorage });
  resetCacheForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("normalizeQuery", () => {
  it("去首尾空白并合并连续空格", () => {
    expect(normalizeQuery("  rust   异步  ")).toBe("rust 异步");
  });
});

describe("搜索历史", () => {
  it("去重置顶并限制条数", () => {
    for (let i = 0; i < 15; i += 1) rememberQuery(`查询 ${i}`);
    rememberQuery("查询 7");
    const history = loadHistory();
    expect(history[0]).toBe("查询 7");
    expect(history).toHaveLength(12);
    expect(history.filter((item) => item === "查询 7")).toHaveLength(1);
  });

  it("删除单条与清空", () => {
    rememberQuery("a");
    rememberQuery("b");
    expect(forgetQuery("a")).toEqual(["b"]);
    expect(clearHistory()).toEqual([]);
    expect(loadHistory()).toEqual([]);
  });

  it("空查询不入历史", () => {
    rememberQuery("   ");
    expect(loadHistory()).toEqual([]);
  });
});

describe("排序偏好", () => {
  it("默认时间逆序", () => {
    expect(loadSortMode()).toBe("time");
  });

  it("记住相关性优先，忽略非法值", () => {
    saveSortMode("relevance");
    expect(loadSortMode()).toBe("relevance");
    window.localStorage.setItem("gaubee:search:sort:v1", "bogus");
    expect(loadSortMode()).toBe("time");
  });
});

describe("结果缓存", () => {
  it("按查询与范围隔离", () => {
    writeCache("all", "语义搜索", [result("a")]);
    expect(readCache("all", "语义搜索")?.[0]?.id).toBe("a");
    expect(readCache("articles", "语义搜索")).toBeNull();
    expect(readCache("all", "另一个查询")).toBeNull();
  });

  it("空白查询不写缓存", () => {
    writeCache("all", "  ", [result("a")]);
    expect(readCache("all", "")).toBeNull();
  });
});

describe("刷新恢复的 snapshot", () => {
  it("写入后可读回", () => {
    writeSnapshot("语义搜索", "event", [result("x")]);
    const snapshot = readSnapshot();
    expect(snapshot?.query).toBe("语义搜索");
    expect(snapshot?.filter).toBe("event");
    expect(snapshot?.results[0]?.id).toBe("x");
  });

  it("超过 30 分钟视为过期", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-26T10:00:00Z"));
      writeSnapshot("旧查询", "all", [result("old")]);
      vi.setSystemTime(new Date("2026-11-26T10:31:00Z"));
      expect(readSnapshot()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("清空查询时删除 snapshot", () => {
    writeSnapshot("语义搜索", "all", [result("x")]);
    writeSnapshot("", "all", []);
    expect(readSnapshot()).toBeNull();
  });
});
