import { afterEach, describe, expect, it, vi } from "vitest";

import {
  JSON_HISTORY_KEY,
  JSON_HISTORY_MAX_BYTES,
  createHistoryScheduler,
  readHistory,
  recordHistory,
  removeHistory,
  type HistoryStorage,
} from "./history";

function storage(): HistoryStorage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
}

describe("json viewer history", () => {
  afterEach(() => vi.useRealTimers());

  it("按时间倒序记录并限制最近 10 条", () => {
    const store = storage();
    for (let i = 0; i < 12; i += 1) recordHistory(store, `{"n":${i}}`, i);
    const result = readHistory(store);
    expect(result).toHaveLength(10);
    expect(result[0].content).toBe('{"n":11}');
    expect(result.at(-1)?.content).toBe('{"n":2}');
  });

  it("相同内容重新记录会移到最前并计算 UTF-8 字节数", () => {
    const store = storage();
    recordHistory(store, '{"name":"中"}', 1);
    const result = recordHistory(store, '{"name":"中"}', 2);
    expect(result).toHaveLength(1);
    expect(result[0].savedAt).toBe(2);
    expect(result[0].bytes).toBe(new TextEncoder().encode('{"name":"中"}').length);
  });

  it("损坏数据安全降级，删除后持久化", () => {
    const store = storage();
    store.setItem(JSON_HISTORY_KEY, "broken");
    expect(readHistory(store)).toEqual([]);
    const item = recordHistory(store, "{}", 1)[0];
    expect(removeHistory(store, item.id)).toEqual([]);
    expect(readHistory(store)).toEqual([]);
  });

  it("单条内容超过 256KB 时不写入历史", () => {
    const store = storage();
    const large = "x".repeat(JSON_HISTORY_MAX_BYTES + 1);
    expect(recordHistory(store, large, 1)).toEqual([]);
    expect(store.getItem(JSON_HISTORY_KEY)).toBeNull();
  });

  it("落盘防抖 2 秒，并支持失焦前 flush", () => {
    vi.useFakeTimers();
    const store = storage();
    const scheduler = createHistoryScheduler(store);
    scheduler.schedule('{"n":1}', 1);
    expect(store.getItem(JSON_HISTORY_KEY)).toBeNull();
    vi.advanceTimersByTime(1999);
    expect(store.getItem(JSON_HISTORY_KEY)).toBeNull();
    vi.advanceTimersByTime(1);
    expect(readHistory(store)[0]?.content).toBe('{"n":1}');

    scheduler.schedule('{"n":2}', 2);
    scheduler.flush();
    expect(readHistory(store)[0]?.content).toBe('{"n":2}');
  });

  it("防抖期间收到超限内容会取消待写入项", () => {
    vi.useFakeTimers();
    const store = storage();
    const scheduler = createHistoryScheduler(store);
    scheduler.schedule('{"n":1}', 1);
    scheduler.schedule("x".repeat(JSON_HISTORY_MAX_BYTES + 1), 2);
    vi.advanceTimersByTime(2000);
    expect(readHistory(store)).toEqual([]);
  });
});
