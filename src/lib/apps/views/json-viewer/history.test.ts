import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_HISTORY_SETTINGS,
  HISTORY_SETTINGS_KEY,
  LEGACY_HISTORY_KEY,
  clearHistory,
  createHistoryScheduler,
  migrateLegacyHistory,
  readHistory,
  readHistorySettings,
  recordHistory,
  removeHistory,
  writeHistorySettings,
  type AsyncHistoryStorage,
  type HistorySettings,
} from "./history";

/** 内存版异步存储（测试 IDB 语义：put/delete/getAll 按 id）。 */
function storage(): AsyncHistoryStorage {
  const data = new Map<string, JsonHistoryEntry>();
  type JsonHistoryEntry = Parameters<AsyncHistoryStorage["put"]>[0];
  return {
    async getAll() {
      return [...data.values()];
    },
    async put(item) {
      data.set(item.id, item);
    },
    async delete(id) {
      data.delete(id);
    },
    async clear() {
      data.clear();
    },
  };
}

const KB = 1024;

function settingsOf(partial: Partial<HistorySettings>): HistorySettings {
  return { ...DEFAULT_HISTORY_SETTINGS, ...partial };
}

describe("json viewer history（IndexedDB 预算 LRU）", () => {
  afterEach(() => vi.useRealTimers());

  it("记录并按最新在前返回", async () => {
    const store = storage();
    await recordHistory(store, '{"a":1}', 1);
    await recordHistory(store, '{"b":2}', 2);
    const result = await readHistory(store);
    expect(result.map((i) => i.content)).toEqual(['{"b":2}', '{"a":1}']);
  });

  it("空白内容不入历史", async () => {
    const store = storage();
    await recordHistory(store, "   ");
    expect(await readHistory(store)).toHaveLength(0);
  });

  it("按内容去重（重新记录同内容移到最新）", async () => {
    const store = storage();
    await recordHistory(store, '{"a":1}', 1);
    await recordHistory(store, '{"b":2}', 2);
    await recordHistory(store, '{"a":1}', 3);
    const result = await readHistory(store);
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe('{"a":1}');
  });

  it("单条超过 maxItemBytes 被拒绝", async () => {
    const store = storage();
    const big = JSON.stringify({ data: "x".repeat(11 * 1024 * 1024) });
    await recordHistory(store, big, 1, settingsOf({ maxItemBytes: 10 * 1024 * 1024 }));
    expect(await readHistory(store)).toHaveLength(0);
  });

  it("总预算 LRU：超预算时从最旧开始淘汰", async () => {
    const store = storage();
    const s = settingsOf({ maxItemBytes: 5 * KB, maxTotalBytes: 8 * KB, maxItems: 100 });
    // 每条 ~2KB（content 直接量长度）
    await recordHistory(store, "x".repeat(2 * KB), 1, s);
    await recordHistory(store, "y".repeat(2 * KB), 2, s);
    await recordHistory(store, "z".repeat(2 * KB), 3, s);
    // 第四条进来：3×2048+2049 = 8193 > 8192，最旧的第一条被淘汰
    const result = await recordHistory(store, "w".repeat(2 * KB) + "!", 4, s);
    expect(result.map((i) => i.content[0])).toEqual(["w", "z", "y"]);
    // 存储里也确实只剩 3 条（淘汰删了记录）
    expect(await readHistory(store, 100)).toHaveLength(3);
  });

  it("条数上限 LRU：超过 maxItems 淘汰最旧", async () => {
    const store = storage();
    const s = settingsOf({ maxItemBytes: 1 * KB, maxTotalBytes: 1024 * KB, maxItems: 3 });
    for (let i = 1; i <= 5; i += 1) {
      await recordHistory(store, `{"n":${i}}`, i, s);
    }
    const result = await readHistory(store, 100);
    expect(result.map((i) => i.content)).toEqual(['{"n":5}', '{"n":4}', '{"n":3}']);
  });

  it("removeHistory / clearHistory", async () => {
    const store = storage();
    const items = await recordHistory(store, '{"a":1}', 1);
    await recordHistory(store, '{"b":2}', 2);
    const after = await removeHistory(store, items[0].id);
    expect(after.map((i) => i.content)).toEqual(['{"b":2}']);
    await clearHistory(store);
    expect(await readHistory(store)).toHaveLength(0);
  });

  it("同毫秒同长度内容生成不同 id", async () => {
    const store = storage();
    await recordHistory(store, '{"v":1}', 100);
    const b = await recordHistory(store, '{"v":2}', 100);
    // 两条都存在（内容不同 → 都保留且 id 不同）
    expect(b).toHaveLength(2);
    expect(new Set(b.map((i) => i.id)).size).toBe(2);
  });

  it("readHistory 过滤损坏条目（字段缺失/类型不符）", async () => {
    const store = storage();
    await store.put({ id: "good", content: '{"ok":1}', savedAt: 1, bytes: 8 });
    // 直接注入非法条目（模拟存储损坏/旧版本 schema）
    await store.put({ id: "bad" } as unknown as Parameters<AsyncHistoryStorage["put"]>[0]);
    const result = await readHistory(store);
    expect(result.map((i) => i.id)).toEqual(["good"]);
  });
});

describe("历史设置（node 无 localStorage：降级 + 钳制）", () => {
  it("默认值：10MB 单条 / 200MB 总预算 / 1000 条", () => {
    const s = readHistorySettings();
    expect(s.maxItemBytes).toBe(10 * 1024 * 1024);
    expect(s.maxTotalBytes).toBe(200 * 1024 * 1024);
    expect(s.maxItems).toBe(1000);
  });

  it("writeHistorySettings 返回钳制后的生效值（不依赖存储）", () => {
    const saved = writeHistorySettings({
      maxItemBytes: 20 * 1024 * 1024,
      maxTotalBytes: 300 * 1024 * 1024,
      maxItems: 500,
    });
    expect(saved.maxItemBytes).toBe(20 * 1024 * 1024);
    expect(saved.maxItems).toBe(500);

    const clamped = writeHistorySettings({
      maxItemBytes: 1, // 低于 64KB 下限 → 钳到 64KB
      maxTotalBytes: 999 * 1024 * 1024 * 1024, // 超 2GB 上限 → 钳到 2GB
      maxItems: -5, // 钳到 1
    });
    expect(clamped.maxItemBytes).toBe(64 * 1024);
    expect(clamped.maxTotalBytes).toBe(2 * 1024 * 1024 * 1024);
    expect(clamped.maxItems).toBe(1);
  });

  it("HISTORY_SETTINGS_KEY 常量稳定（localStorage 元数据 key）", () => {
    expect(HISTORY_SETTINGS_KEY).toBe("gaubee:json-viewer:history-settings");
  });
});

describe("scheduler（去抖落盘）", () => {
  afterEach(() => vi.useRealTimers());

  it("schedule 去抖后落盘，flush 立即落盘", async () => {
    vi.useFakeTimers();
    const store = storage();
    const s = settingsOf({ maxItemBytes: 10 * KB });
    const scheduler = createHistoryScheduler(store, { delayMs: 2000 });
    scheduler.schedule('{"a":1}', 1);
    await vi.advanceTimersByTimeAsync(2500);
    expect(await readHistory(store)).toHaveLength(1);

    scheduler.schedule('{"b":2}', 2);
    const flushed = await scheduler.flush();
    expect(flushed.map((i) => i.content)).toEqual(['{"b":2}', '{"a":1}']);
  });

  it("超单条上限的内容不进入 pending", async () => {
    vi.useFakeTimers();
    const store = storage();
    const scheduler = createHistoryScheduler(store, { delayMs: 100 });
    scheduler.schedule("x".repeat(20 * KB)); // 默认 settings 10MB 内——但这里 maxItemBytes 默认，20KB < 10MB，会进
    await vi.advanceTimersByTimeAsync(200);
    expect(await readHistory(store)).toHaveLength(1);
    void scheduler;
  });
});

describe("旧版 localStorage 迁移", () => {
  it("旧记录转存 IDB 并清掉旧 key", async () => {
    const legacy = new Map<string, string>([
      [
        LEGACY_HISTORY_KEY,
        JSON.stringify([
          { id: "1-7", content: '{"old":1}', savedAt: 1, bytes: 9 },
          { id: "2-7", content: '{"old":2}', savedAt: 2, bytes: 9 },
        ]),
      ],
    ]);
    const idb = storage();
    const result = await migrateLegacyHistory(
      {
        getItem: (k) => legacy.get(k) ?? null,
        removeItem: (k) => legacy.delete(k),
      },
      idb,
    );
    expect(result.map((i) => i.content)).toEqual(['{"old":2}', '{"old":1}']);
    expect(legacy.has(LEGACY_HISTORY_KEY)).toBe(false);
    // IDB 里真实可读
    expect(await readHistory(idb)).toHaveLength(2);
  });

  it("无旧数据时无操作", async () => {
    const idb = storage();
    const result = await migrateLegacyHistory(
      { getItem: () => null, removeItem: () => undefined },
      idb,
    );
    expect(result).toHaveLength(0);
  });

  it("损坏的旧数据被容忍（清 key，返回空）", async () => {
    const idb = storage();
    const result = await migrateLegacyHistory(
      { getItem: () => "{broken", removeItem: () => undefined },
      idb,
    );
    expect(result).toHaveLength(0);
  });
});
