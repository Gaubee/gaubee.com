/**
 * 大 JSON 虚拟树的扁平化与窗口计算（无 DOM 依赖，server project 可测）。
 * 只为当前展开分支生成行，视图再按滚动窗口渲染，避免一次创建数千个递归组件。
 */

import { valueTypeOf, type JsonValueType } from "./json-core";
import type { JsonPathSegment } from "./query";

export interface VirtualTreeRow {
  path: JsonPathSegment[];
  pathKey: string;
  name: string | null;
  value: unknown;
  depth: number;
  kind: JsonValueType;
  childCount: number;
  isContainer: boolean;
}

export const VIRTUAL_LONG_STRING = 120;

/** 虚拟树标量预览与普通树保持一致，避免超长字符串撑爆行宽。 */
export function formatVirtualScalar(
  value: unknown,
  kind: JsonValueType = valueTypeOf(value),
): string {
  if (kind === "string") {
    const raw = value as string;
    if (raw.length > VIRTUAL_LONG_STRING) {
      return `${JSON.stringify(raw.slice(0, VIRTUAL_LONG_STRING)).slice(0, -1)}…"`;
    }
    return JSON.stringify(raw);
  }
  if (kind === "null") return "null";
  return String(value);
}

/** 返回当前展开状态下的深度优先行列表。 */
export function flattenJsonTree(value: unknown, openPaths: ReadonlySet<string>): VirtualTreeRow[] {
  const rows: VirtualTreeRow[] = [];
  const stack: Array<{
    path: JsonPathSegment[];
    name: string | null;
    value: unknown;
    depth: number;
  }> = [{ path: [], name: null, value, depth: 0 }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const kind = valueTypeOf(current.value);
    const children = childEntries(current.value);
    const key = pathKey(current.path);
    rows.push({
      path: current.path,
      pathKey: key,
      name: current.name,
      value: current.value,
      depth: current.depth,
      kind,
      childCount: children.length,
      isContainer: children.length > 0,
    });
    if (children.length === 0 || !openPaths.has(key)) continue;
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const [name, child] = children[index];
      stack.push({
        path: [...current.path, name],
        name: String(name),
        value: child,
        depth: current.depth + 1,
      });
    }
  }
  return rows;
}

/** 返回所有容器路径，用于“全部展开”。 */
export function containerPaths(value: unknown): string[] {
  const result: string[] = [];
  const stack: Array<{ path: JsonPathSegment[]; value: unknown }> = [{ path: [], value }];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const children = childEntries(current.value);
    if (children.length === 0) continue;
    result.push(pathKey(current.path));
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const [name, child] = children[index];
      stack.push({ path: [...current.path, name], value: child });
    }
  }
  return result;
}

/** 根据滚动位置计算需要挂载的行区间（含 overscan）。 */
export function visibleRange(
  total: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight = 26,
  overscan = 8,
): { start: number; end: number; offsetTop: number; totalHeight: number } {
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
  const end = Math.min(total, first + visibleCount);
  return { start: first, end, offsetTop: first * rowHeight, totalHeight: total * rowHeight };
}

/** 路径编码稳定且不会与字符串键冲突。 */
export function pathKey(path: readonly JsonPathSegment[]): string {
  return JSON.stringify(path);
}

function childEntries(value: unknown): Array<[JsonPathSegment, unknown]> {
  if (Array.isArray(value)) return value.map((child, index) => [index, child]);
  if (value !== null && typeof value === "object")
    return Object.entries(value as Record<string, unknown>);
  return [];
}
