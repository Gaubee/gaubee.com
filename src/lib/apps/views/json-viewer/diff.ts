/**
 * JSON 键级 diff 纯逻辑（无 DOM 依赖，server project 可测）。
 * 对象按键、数组按下标递归比较；结果保留 JSONPath，视图可直接渲染成列表。
 */

import { formatJsonPath, type JsonPathSegment } from "./query";

export type DiffKind = "added" | "removed" | "changed";

export interface JsonDiffEntry {
  path: JsonPathSegment[];
  pathText: string;
  kind: DiffKind;
  before: unknown;
  after: unknown;
}

/** 返回所有有差异的键/元素，结果按路径访问顺序稳定排列。 */
export function diffJson(before: unknown, after: unknown): JsonDiffEntry[] {
  const entries: JsonDiffEntry[] = [];
  visit(before, after, [], entries);
  return entries;
}

function visit(
  before: unknown,
  after: unknown,
  path: JsonPathSegment[],
  entries: JsonDiffEntry[],
): void {
  if (isRecord(before) && isRecord(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const key of keys) {
      const hasBefore = Object.prototype.hasOwnProperty.call(before, key);
      const hasAfter = Object.prototype.hasOwnProperty.call(after, key);
      const childPath = [...path, key];
      if (!hasBefore) {
        add(entries, childPath, "added", undefined, after[key]);
      } else if (!hasAfter) {
        add(entries, childPath, "removed", before[key], undefined);
      } else {
        visit(before[key], after[key], childPath, entries);
      }
    }
    return;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      const childPath = [...path, index];
      if (index >= before.length) add(entries, childPath, "added", undefined, after[index]);
      else if (index >= after.length) add(entries, childPath, "removed", before[index], undefined);
      else visit(before[index], after[index], childPath, entries);
    }
    return;
  }
  if (!sameJsonValue(before, after)) add(entries, path, "changed", before, after);
}

function add(
  entries: JsonDiffEntry[],
  path: JsonPathSegment[],
  kind: DiffKind,
  before: unknown,
  after: unknown,
): void {
  entries.push({ path, pathText: formatJsonPath(path), kind, before, after });
}

function sameJsonValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right || left === null || right === null) return false;
  if (Array.isArray(left) || Array.isArray(right)) return false;
  if (typeof left === "object" && typeof right === "object") {
    const a = left as Record<string, unknown>;
    const b = right as Record<string, unknown>;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && sameJsonValue(a[key], b[key]));
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
