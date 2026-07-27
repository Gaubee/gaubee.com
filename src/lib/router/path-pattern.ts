/**
 * path-pattern：轻量 path-to-regexp 风格的路径模式编译器。
 *
 * 设计意图（2026-07-27）：
 * RouteContract 的 pattern 是相对段（如 'repo/:owner/:repo'），
 * 需要与父级拼接 + 编译成正则 + 提取参数名。
 * 不引入 path-to-regexp 依赖，自研一个最小实现覆盖 :param 风格。
 *
 * 支持的语法：
 * - 静态段：'repo'、'files'
 * - 命名参数：':owner'、':repo'
 * - 可选尾斜杠：模式自动容忍 '/foo/' 与 '/foo' 等价
 * - 不支持：通配符 *、可选参数 :param?、正则约束 :param(\\d+)
 *   （约束由 zod schema 在 parse 阶段承担，路径层只做结构提取）
 */

/** 编译后的路径模式。 */
export interface CompiledPattern {
  /** 用于匹配绝对路径的正则（带 ^ $ 锚定）。 */
  readonly regex: RegExp;
  /** 按出现顺序的参数名列表（如 ['owner', 'repo']）。 */
  readonly paramNames: readonly string[];
}

const PARAM_RE = /:([A-Za-z_][A-Za-z0-9_]*)/g;

/** 编译相对 pattern 为正则 + 参数名列表。
 *
 * @param pattern 相对段，如 'repo/:owner/:repo' 或 ''（index route）
 * @returns CompiledPattern，regex 已锚定（^...$）
 *
 * @example
 * compilePattern('repo/:owner/:repo') → /\Arepo\/([^/]+)\/([^/]+)\/?\z/
 * compilePattern('')                  → /\A\/?\z/
 */
export function compilePattern(pattern: string): CompiledPattern {
  // 归一化：去掉首尾斜杠与空白
  const cleaned = pattern.trim().replace(/^\/+|\/+$/g, "");
  if (cleaned === "") {
    // index route：匹配空字符串或单独的 '/'
    return { regex: /^\/?$/, paramNames: [] };
  }

  const paramNames: string[] = [];
  // 转义静态字符 + 替换 :param 为捕获组
  let regexSrc = cleaned.replace(PARAM_RE, (_, name: string) => {
    paramNames.push(name);
    return "([^/]+)";
  });
  // 转义剩余的 '/'（替换后已无 :param，剩余 '/' 是静态分隔符）
  regexSrc = regexSrc.replace(/\//g, "\\/");
  // 尾部容忍可选斜杠
  regexSrc = `^${regexSrc}\\/?$`;

  return { regex: new RegExp(regexSrc), paramNames };
}

/** 拼接父级绝对前缀与子级相对 pattern，得到子级的绝对 pattern。
 *
 * @param parentAbsolute 父级的绝对前缀，如 '/app/github'
 * @param childRelative  子级的相对段，如 'repo/:owner/:repo' 或 ''
 * @returns 子级绝对 pattern，如 '/app/github/repo/:owner/:repo'
 */
export function joinPattern(parentAbsolute: string, childRelative: string): string {
  const p = parentAbsolute.replace(/\/+$/, "");
  const c = childRelative.replace(/^\/+|\/+$/g, "");
  if (c === "") return p;
  return `${p}/${c}`;
}

/** 把带 :param 的 pattern + 参数值对象，渲染成实际路径。
 *
 * @param pattern 相对或绝对 pattern，如 'repo/:owner/:repo'
 * @param params  参数值，如 { owner: 'gaubee', repo: 'gaubee.com' }
 * @returns 渲染后的路径，如 'repo/gaubee/gaubee.com'
 *
 * 多余的 params key 会被忽略；缺失的会保留原 :name（调用方应通过类型系统避免）。
 */
export function stringifyPattern(
  pattern: string,
  params: Readonly<Record<string, string>>,
): string {
  return pattern.replace(PARAM_RE, (_, name: string) => {
    const v = params[name];
    return v !== undefined ? encodeURIComponent(v) : `:${name}`;
  });
}
