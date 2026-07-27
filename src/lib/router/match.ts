/**
 * match：Route 树的 URL 解析（纯函数，无副作用）。
 *
 * 设计意图（2026-07-27）：
 * 给定 Activity root（RouteContract 树）+ location（pathname + search），
 * 返回匹配结果：成功则给出 Route 链 + 已 parse 的 params/search；
 * 失败则给出原因（无匹配 / zod parse 失败）。
 *
 * 算法（段数组模型，比正则前缀消耗更直观）：
 * 1. 剥除 Activity 前缀，得到相对路径
 * 2. 把相对路径 split 成段（'/' 分隔）
 * 3. 从 root 起逐层匹配：每层 pattern 也 split 成段，逐段比对
 *    - 静态段必须相等
 *    - :param 段捕获值
 * 4. 命中链路收集后，统一对 params/search 跑 zod parse
 *
 * 嵌套示例：
 *   pathname = '/app/github/repo/o/r/file/src/index.ts'
 *   prefix   = '/app/github'
 *   relative = '/repo/o/r/file/src/index.ts'
 *   segments = ['repo','o','r','file','src','index.ts']
 *
 *   root pattern ''           → 消耗 0 段，剩余 ['repo','o','r','file','src','index.ts']
 *     child 'repo/:o/:r'      → 消耗 3 段，捕获 {o:'o', r:'r'}，剩余 ['file','src','index.ts']
 *       grandchild 'file/*path' → ...（当前不支持通配，需显式段）
 *
 * 注意：
 * - root 自身 pattern 通常是 ''（index route）
 * - 同层多个 children：按声明顺序，首个完全匹配者胜出
 * - zod parse 失败时仍返回链路（标记 error），由上层决定 fallback
 */
import type { ZodSchema } from "zod";

import type { ErasedRouteContract } from "./contract";

// re-export parseSearchString 供 index.ts 统一出口（保持向后兼容）
export { parseSearchString } from "./search";
import { parseSearchString } from "./search";

/** 匹配成功时的单层节点信息。 */
export interface MatchedRouteNode {
  /** 该 Route 的绝对 pattern（含全部父级前缀）。 */
  readonly absolutePattern: string;
  /** 该 Route 的契约。 */
  readonly route: ErasedRouteContract;
  /** 从 URL 提取的原始参数（字符串值，未经 zod parse）。 */
  readonly rawParams: Readonly<Record<string, string>>;
}

/** 树匹配结果（discriminated union）。 */
export type RouteMatchResult =
  | { readonly kind: "matched"; readonly chain: readonly MatchedRouteNode[] }
  | { readonly kind: "no-match"; readonly reason: "no-route" }
  | {
      readonly kind: "parse-error";
      readonly reason: "params" | "search";
      readonly chain: readonly MatchedRouteNode[];
      readonly errors: unknown;
    };

/** 解析入口：对一棵 Route 树 + 完整 location 做匹配。
 *
 * @param root       Activity 的根 Route
 * @param pathname   完整 pathname（如 '/app/github/repo/o/r'）
 * @param search     完整 search 串（如 '?tab=files&sha=abc'）
 * @param activityPrefix Activity 的绝对前缀（如 '/app/github'）
 */
export function matchRouteTree(
  root: ErasedRouteContract,
  pathname: string,
  search: string,
  activityPrefix: string,
): RouteMatchResult {
  // 1. 剥除 Activity 前缀
  const relativePath = stripPrefix(pathname, activityPrefix);
  // 2. 切段（去掉空段）
  const segments = splitSegments(relativePath);

  // 3. 深度优先匹配
  const chain = matchChain(root, segments, activityPrefix);
  if (chain.length === 0) {
    return { kind: "no-match", reason: "no-route" };
  }

  // 4. zod parse params（合并整条链）
  const mergedRaw = mergeRawParams(chain);
  const leaf = chain[chain.length - 1].route;
  const paramsSchema = leaf.params as ZodSchema | undefined;
  if (paramsSchema) {
    const parsed = paramsSchema.safeParse(mergedRaw);
    if (!parsed.success) {
      return { kind: "parse-error", reason: "params", chain, errors: parsed.error };
    }
  }

  // 5. zod parse search（仅叶子节点）
  const searchSchema = leaf.search as ZodSchema | undefined;
  if (searchSchema) {
    const searchObj = parseSearchString(search);
    const parsed = searchSchema.safeParse(searchObj);
    if (!parsed.success) {
      return { kind: "parse-error", reason: "search", chain, errors: parsed.error };
    }
  }

  return { kind: "matched", chain };
}

/** 从 path 剥除 prefix，返回剩余相对路径。 */
function stripPrefix(path: string, prefix: string): string {
  const p = prefix.replace(/\/+$/, "");
  if (path === p) return "";
  if (path.startsWith(p + "/")) return path.slice(p.length);
  return path;
}

/** 把路径切成段（去掉首尾空白与空段）。
 *  '/repo/o/r/' → ['repo','o','r']，'' → [] */
function splitSegments(path: string): string[] {
  const cleaned = path.replace(/^\/+|\/+$/g, "");
  if (cleaned === "") return [];
  return cleaned.split("/").map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  });
}

/** 把 pattern 也切成段（保留 :param 标记，便于逐段比对）。
 *  'repo/:owner/:repo' → [{kind:'static',value:'repo'},{kind:'param',name:'owner'},{kind:'param',name:'repo'}]
 *  '' → [] */
interface PatternSegment {
  kind: "static" | "param";
  value: string; // static: 字面值；param: 参数名
}
function splitPatternSegments(pattern: string): PatternSegment[] {
  const cleaned = pattern.replace(/^\/+|\/+$/g, "");
  if (cleaned === "") return [];
  return cleaned.split("/").map((seg) => {
    if (seg.startsWith(":")) {
      return { kind: "param" as const, value: seg.slice(1) };
    }
    return { kind: "static" as const, value: seg };
  });
}

/** 拼接父级绝对 pattern 与子级相对 pattern。 */
function joinAbsolute(parent: string, relative: string): string {
  const p = parent.replace(/\/+$/, "");
  const r = relative.replace(/^\/+|\/+$/g, "");
  if (r === "") return p;
  return `${p}/${r}`;
}

/** 递归匹配：在 segments[consumed..] 上尝试匹配 route 与其子节点。 */
function matchChain(
  route: ErasedRouteContract,
  segments: readonly string[],
  parentAbsolute: string,
): MatchedRouteNode[] {
  const absolutePattern = joinAbsolute(parentAbsolute, route.pattern);
  const patternSegs = splitPatternSegments(route.pattern);

  // 当前层尝试消耗 patternSegs.length 段
  if (segments.length < patternSegs.length) {
    return []; // 段数不够，无法匹配
  }

  // 逐段比对
  const rawParams: Record<string, string> = {};
  for (let i = 0; i < patternSegs.length; i++) {
    const ps = patternSegs[i];
    const actual = segments[i];
    if (ps.kind === "static") {
      if (ps.value !== actual) return []; // 静态段不等，失败
    } else {
      rawParams[ps.value] = actual; // :param 捕获
    }
  }

  const node: MatchedRouteNode = { absolutePattern, route, rawParams };
  const remaining = segments.slice(patternSegs.length);

  // 无剩余段：当前节点就是叶子
  if (remaining.length === 0) {
    return [node];
  }

  // 有剩余段 + 有子节点：递归向下
  if (route.children && route.children.length > 0) {
    for (const child of route.children) {
      const childChain = matchChain(child, remaining, absolutePattern);
      if (childChain.length > 0) {
        return [node, ...childChain];
      }
    }
  }

  // 有剩余段但无子节点命中：当前节点不完整匹配，失败
  return [];
}

/** 合并链上所有节点的 rawParams（子节点覆盖父级同名参数）。 */
function mergeRawParams(chain: readonly MatchedRouteNode[]): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const node of chain) {
    Object.assign(merged, node.rawParams);
  }
  return merged;
}
