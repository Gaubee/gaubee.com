/**
 * JSON 查看历史的纯存储逻辑（无 DOM 依赖，server project 可测）。
 *
 * 存储：IndexedDB（数据层封装见 history-idb.ts），不占用 localStorage——
 * 巨大 JSON（单条上限内最大 10MB）绝不能进 localStorage 的 ~5MB 同步配额。
 * 仅历史设置（几个数字的元数据）留在 localStorage。
 *
 * 淘汰：LRU 预算制——总字节超 maxTotalBytes 或条数超 maxItems 时，
 * 从最旧开始淘汰（按 savedAt 升序）。单条超 maxItemBytes 直接拒绝记录
 * （大内容用户手里有文件本身，进历史没有恢复价值且是负担）。
 */

export interface AsyncHistoryStorage {
  getAll: () => Promise<JsonHistoryItem[]>;
  put: (item: JsonHistoryItem) => Promise<void>;
  delete: (id: string) => Promise<void>;
  clear: () => Promise<void>;
}

export interface JsonHistoryItem {
  id: string;
  content: string;
  savedAt: number;
  bytes: number;
}

export interface HistorySettings {
  /** 单条上限（字节）。 */
  maxItemBytes: number;
  /** 历史总预算（字节），超出按最旧淘汰。 */
  maxTotalBytes: number;
  /** 条数软上限（防记录数爆炸）。 */
  maxItems: number;
}

export const DEFAULT_HISTORY_SETTINGS: HistorySettings = {
  maxItemBytes: 10 * 1024 * 1024, // 10MB
  maxTotalBytes: 200 * 1024 * 1024, // 200MB
  maxItems: 1000,
};

export const HISTORY_SETTINGS_KEY = "gaubee:json-viewer:history-settings";

// ---------------------------------------------------------------------------
// 设置（小元数据，localStorage 同步读写；历史数据本体在 IndexedDB）
// ---------------------------------------------------------------------------

/** 读取设置；缺失/损坏/无 localStorage 环境（SSR、node 测试）时回落默认值，并把越界值钳制到安全区间。 */
export function readHistorySettings(): HistorySettings {
  if (typeof localStorage === "undefined") return { ...DEFAULT_HISTORY_SETTINGS };
  try {
    const raw = localStorage.getItem(HISTORY_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_HISTORY_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<HistorySettings>;
    return clampSettings({
      maxItemBytes: numberOr(parsed.maxItemBytes, DEFAULT_HISTORY_SETTINGS.maxItemBytes),
      maxTotalBytes: numberOr(parsed.maxTotalBytes, DEFAULT_HISTORY_SETTINGS.maxTotalBytes),
      maxItems: numberOr(parsed.maxItems, DEFAULT_HISTORY_SETTINGS.maxItems),
    });
  } catch {
    return { ...DEFAULT_HISTORY_SETTINGS };
  }
}

/** 写入设置（钳制后落盘），返回钳制后的生效值。 */
export function writeHistorySettings(settings: HistorySettings): HistorySettings {
  const clamped = clampSettings(settings);
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(HISTORY_SETTINGS_KEY, JSON.stringify(clamped));
    } catch {
      // ignore（隐私模式）：设置写不进去不影响主功能
    }
  }
  return clamped;
}

const MIN_ITEM_BYTES = 64 * 1024; // 64KB
const MAX_ITEM_BYTES_CEIL = 64 * 1024 * 1024; // 64MB
const MIN_TOTAL_BYTES = 1024 * 1024; // 1MB
const MAX_TOTAL_BYTES_CEIL = 2 * 1024 * 1024 * 1024; // 2GB
const MIN_ITEMS = 1;
const MAX_ITEMS_CEIL = 10000;

function clampSettings(s: HistorySettings): HistorySettings {
  return {
    maxItemBytes: clamp(s.maxItemBytes, MIN_ITEM_BYTES, MAX_ITEM_BYTES_CEIL),
    maxTotalBytes: clamp(s.maxTotalBytes, MIN_TOTAL_BYTES, MAX_TOTAL_BYTES_CEIL),
    maxItems: clamp(Math.round(s.maxItems), MIN_ITEMS, MAX_ITEMS_CEIL),
  };
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

// ---------------------------------------------------------------------------
// 读取 / 记录 / 删除（全部异步，走 AsyncHistoryStorage）
// ---------------------------------------------------------------------------

function byNewestFirst(a: JsonHistoryItem, b: JsonHistoryItem): number {
  return b.savedAt - a.savedAt;
}

/** 读取全部历史（按最新在前排序）。损坏数据被容忍为空。 */
export async function readHistory(
  storage: AsyncHistoryStorage,
  limit = DEFAULT_HISTORY_SETTINGS.maxItems,
): Promise<JsonHistoryItem[]> {
  try {
    const items = await storage.getAll();
    return items.filter(isHistoryItem).sort(byNewestFirst).slice(0, limit);
  } catch {
    return [];
  }
}

/** 记录一份内容并返回最新列表；空白/超单条上限的内容不入历史。 */
export async function recordHistory(
  storage: AsyncHistoryStorage,
  content: string,
  savedAt = Date.now(),
  settings = readHistorySettings(),
): Promise<JsonHistoryItem[]> {
  if (content.trim() === "") return readHistory(storage, settings.maxItems);
  const bytes = utf8ByteLength(content);
  if (bytes > settings.maxItemBytes) return readHistory(storage, settings.maxItems);

  const all = await storage.getAll();
  const kept = all.filter((item) => item.content !== content);
  const keptIds = new Set(kept.map((item) => item.id));
  for (const old of all) {
    if (!keptIds.has(old.id)) await storage.delete(old.id);
  }

  const item: JsonHistoryItem = { id: makeId(savedAt, content), content, savedAt, bytes };
  await storage.put(item);
  return enforceLru(storage, [item, ...kept], settings);
}

/** 删除单条记录。 */
export async function removeHistory(
  storage: AsyncHistoryStorage,
  id: string,
  settings = readHistorySettings(),
): Promise<JsonHistoryItem[]> {
  await storage.delete(id);
  return readHistory(storage, settings.maxItems);
}

/** 清空全部历史。 */
export async function clearHistory(storage: AsyncHistoryStorage): Promise<void> {
  await storage.clear();
}

// ---------------------------------------------------------------------------
// 落盘调度器：把历史写入从打字/解析链路移出（去抖 + 失焦兜底 flush）
// ---------------------------------------------------------------------------

export interface HistorySchedulerOptions {
  /** 防抖时长，默认 2 秒。 */
  delayMs?: number;
  onRecorded?: (items: JsonHistoryItem[]) => void;
}

export interface HistoryScheduler {
  schedule: (content: string, savedAt?: number) => void;
  flush: () => Promise<JsonHistoryItem[]>;
}

export function createHistoryScheduler(
  storage: AsyncHistoryStorage,
  options: HistorySchedulerOptions = {},
): HistoryScheduler {
  const delayMs = options.delayMs ?? 2000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { content: string; savedAt: number } | null = null;

  const clearTimer = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };

  const flush = (): Promise<JsonHistoryItem[]> => {
    clearTimer();
    const current = pending;
    pending = null;
    if (!current) return readHistory(storage);
    return recordHistory(storage, current.content, current.savedAt).then((items) => {
      options.onRecorded?.(items);
      return items;
    });
  };

  const schedule = (content: string, savedAt = Date.now()): void => {
    clearTimer();
    if (content.trim() === "" || utf8ByteLength(content) > readHistorySettings().maxItemBytes) {
      pending = null;
      return;
    }
    pending = { content, savedAt };
    timer = setTimeout(() => void flush(), delayMs);
  };

  return { schedule, flush };
}

/**
 * LRU 预算 enforcement：按最新在前排列后，累计字节超 maxTotalBytes 或
 * 条数超 maxItems 时从最旧（尾部）开始淘汰，删除对应的存储记录。
 */
async function enforceLru(
  storage: AsyncHistoryStorage,
  ordered: JsonHistoryItem[],
  settings: HistorySettings,
): Promise<JsonHistoryItem[]> {
  const sorted = [...ordered].sort(byNewestFirst);
  const kept: JsonHistoryItem[] = [];
  let total = 0;
  for (const item of sorted) {
    if (kept.length >= settings.maxItems || total + item.bytes > settings.maxTotalBytes) {
      await storage.delete(item.id);
      continue;
    }
    kept.push(item);
    total += item.bytes;
  }
  return kept;
}

function makeId(savedAt: number, content: string): string {
  // 同毫秒 + 同长度可能碰撞，追加内容尾部哈希增强唯一性
  let hash = 0;
  for (let i = Math.max(0, content.length - 256); i < content.length; i += 1) {
    hash = (hash * 31 + content.charCodeAt(i)) | 0;
  }
  return `${savedAt}-${content.length}-${(hash >>> 0).toString(36)}`;
}

// ---------------------------------------------------------------------------
// 旧版 localStorage 数据迁移（一次性）：≤256KB 的存量记录转存 IndexedDB
// ---------------------------------------------------------------------------

export const LEGACY_HISTORY_KEY = "gaubee:json-viewer:history";

/** 迁移用兼容类型（与旧版同步接口同形）。 */
export interface LegacyHistoryStorage {
  getItem: (key: string) => string | null;
  removeItem: (key: string) => void;
}

/** 把旧版 localStorage 历史迁移进 IndexedDB，完成后清掉旧 key。 */
export async function migrateLegacyHistory(
  legacyStorage: LegacyHistoryStorage,
  storage: AsyncHistoryStorage,
  settings = readHistorySettings(),
): Promise<JsonHistoryItem[]> {
  let legacy: JsonHistoryItem[] = [];
  try {
    const raw = legacyStorage.getItem(LEGACY_HISTORY_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) legacy = parsed.filter(isHistoryItem);
    }
  } catch {
    legacy = [];
  }
  if (legacy.length > 0) {
    const existing = new Set((await storage.getAll()).map((item) => item.content));
    for (const item of legacy) {
      if (!existing.has(item.content)) await storage.put(item);
    }
  }
  try {
    legacyStorage.removeItem(LEGACY_HISTORY_KEY);
  } catch {
    // ignore
  }
  return enforceLru(storage, await storage.getAll(), settings);
}

function isHistoryItem(value: unknown): value is JsonHistoryItem {
  if (value === null || typeof value !== "object") return false;
  const item = value as Partial<JsonHistoryItem>;
  return (
    typeof item.id === "string" &&
    typeof item.content === "string" &&
    typeof item.savedAt === "number" &&
    typeof item.bytes === "number"
  );
}

function utf8ByteLength(content: string): number {
  return new TextEncoder().encode(content).length;
}
