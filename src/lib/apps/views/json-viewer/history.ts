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
