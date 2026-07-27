/**
 * search：URL search 串的序列化与反序列化。
 *
 * 设计意图（2026-07-27）：
 * URLSearchParams 不能处理 zod 提供的「默认值 / 嵌套对象 / 数组」等高级特性，
 * 但 GaubeeOS 的 search schema 全是扁平 { key: string | number | ... } 形式，
 * 用 URLSearchParams 足够。这里提供类型擦除的工具函数。
 *
 * 转换约定：
 * - 入参 zod schema 形状是扁平 Record<string, string|number|boolean|null|undefined>
 * - 序列化：非空值 encodeURIComponent；null/undefined 跳过
 * - 反序列化：URLSearchParams → Record<string, string>（值保持原样，由 zod 做 coerce）
 */

/** 把 search 串解析成 Record<string, string>。
 *  值类型保持原样（string），交给 zod schema 做 coerce / 类型转换。 */
export function parseSearchString(search: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!search) return out;
  const s = search.startsWith("?") ? search.slice(1) : search;
  if (!s) return out;
  const params = new URLSearchParams(s);
  for (const [key, val] of params.entries()) {
    out[key] = val;
  }
  return out;
}

/** 把 Record<string, unknown> 序列化成 search 串（含前导 '?'）。
 *  - string / number / boolean：encodeURIComponent
 *  - null / undefined：跳过
 *  - 数组：暂不支持（GaubeeOS 当前无此需求）
 *  返回空串表示无参数（不是 '?'）。 */
export function stringifySearch(params: Readonly<Record<string, unknown>>): string {
  const sp = new URLSearchParams();
  for (const [key, val] of Object.entries(params)) {
    if (val === null || val === undefined) continue;
    sp.set(key, String(val));
  }
  const str = sp.toString();
  return str ? `?${str}` : "";
}
