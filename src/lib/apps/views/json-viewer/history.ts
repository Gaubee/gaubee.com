/**
 * JSON 查看历史的纯存储逻辑（无 DOM 依赖，server project 可测）。
 * 只保存最近 10 条内容，按内容去重，调用方决定何时记录。
 */

export interface HistoryStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
}

export interface JsonHistoryItem {
  id: string;
  content: string;
  savedAt: number;
  bytes: number;
}

export const JSON_HISTORY_KEY = "gaubee:json-viewer:history";
export const JSON_HISTORY_LIMIT = 10;
export const JSON_HISTORY_MAX_BYTES = 256 * 1024;

/** 从存储读取并清理损坏/过期数据。 */
export function readHistory(
  storage: HistoryStorage,
  limit = JSON_HISTORY_LIMIT,
): JsonHistoryItem[] {
  try {
    const raw = storage.getItem(JSON_HISTORY_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isHistoryItem)
      .sort((a, b) => b.savedAt - a.savedAt)
      .slice(0, limit);
  } catch {
    return [];
  }
}

/** 记录一份内容并返回最新列表；空白内容不入历史。 */
export function recordHistory(
  storage: HistoryStorage,
  content: string,
  savedAt = Date.now(),
  limit = JSON_HISTORY_LIMIT,
): JsonHistoryItem[] {
  if (content.trim() === "") return readHistory(storage, limit);
  if (utf8ByteLength(content) > JSON_HISTORY_MAX_BYTES) return readHistory(storage, limit);
  const previous = readHistory(storage, limit).filter((item) => item.content !== content);
  const item: JsonHistoryItem = {
    id: `${savedAt}-${content.length}`,
    content,
    savedAt,
    bytes: new TextEncoder().encode(content).length,
  };
  const next = [item, ...previous].slice(0, limit);
  try {
    storage.setItem(JSON_HISTORY_KEY, JSON.stringify(next));
  } catch {
    // 隐私模式/配额不足时，当前输入仍可正常使用。
  }
  return next;
}

export interface HistorySchedulerOptions {
  /** 防抖时长，默认 2 秒。 */
  delayMs?: number;
  onRecorded?: (items: JsonHistoryItem[]) => void;
}

/** 将历史落盘从输入解析链路中移出，避免每次打字同步写 localStorage。 */
export function createHistoryScheduler(
  storage: HistoryStorage,
  options: HistorySchedulerOptions = {},
): { schedule: (content: string, savedAt?: number) => void; flush: () => JsonHistoryItem[] } {
  const delayMs = options.delayMs ?? 2000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: { content: string; savedAt: number } | null = null;

  const clearTimer = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };
  const flush = (): JsonHistoryItem[] => {
    clearTimer();
    const current = pending;
    pending = null;
    if (!current) return readHistory(storage);
    const items = recordHistory(storage, current.content, current.savedAt);
    options.onRecorded?.(items);
    return items;
  };
  const schedule = (content: string, savedAt = Date.now()): void => {
    clearTimer();
    if (content.trim() === "" || utf8ByteLength(content) > JSON_HISTORY_MAX_BYTES) {
      pending = null;
      return;
    }
    pending = { content, savedAt };
    timer = setTimeout(flush, delayMs);
  };

  return { schedule, flush };
}

/** 删除单条记录。 */
export function removeHistory(storage: HistoryStorage, id: string): JsonHistoryItem[] {
  const next = readHistory(storage).filter((item) => item.id !== id);
  try {
    storage.setItem(JSON_HISTORY_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
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
