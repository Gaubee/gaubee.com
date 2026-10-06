/**
 * JSONPath 子集解析与求值（无 DOM 依赖，server project 可测）。
 *
 * 支持根 `$`、点属性、数组下标、通配符 `*`、递归下降 `..name`/`..*`，
 * 以及 `['key']`/`["key"]` 形式的属性访问。结果保留完整路径，供视图高亮和提取。
 */

export type JsonPathSegment = string | number;

export type QueryToken =
  | { kind: "property"; key: string }
  | { kind: "index"; index: number }
  | { kind: "wildcard" }
  | { kind: "recursive"; key: string | null };

export interface QueryMatch {
  path: JsonPathSegment[];
  value: unknown;
}

export type QueryOutcome =
  | { ok: true; tokens: QueryToken[]; matches: QueryMatch[] }
  | { ok: false; error: string };

interface ParseState {
  query: string;
  index: number;
}

/** 解析 JSONPath 子集。 */
export function parseJsonPath(
  query: string,
): { ok: true; tokens: QueryToken[] } | { ok: false; error: string } {
  const normalized = query.trim();
  if (!normalized.startsWith("$")) return { ok: false, error: "路径必须以 $ 开头" };
  const state: ParseState = { query: normalized, index: 1 };
  const tokens: QueryToken[] = [];

  while (state.index < state.query.length) {
    const ch = state.query[state.index];
    if (ch === ".") {
      const recursive = state.query[state.index + 1] === ".";
      state.index += recursive ? 2 : 1;
      if (state.query[state.index] === "*") {
        tokens.push(recursive ? { kind: "recursive", key: null } : { kind: "wildcard" });
        state.index += 1;
        continue;
      }
      const key = readBareKey(state);
      if (!key)
        return { ok: false, error: recursive ? ".. 后需要属性名或 *" : ". 后需要属性名或 *" };
      tokens.push(recursive ? { kind: "recursive", key } : { kind: "property", key });
      continue;
    }
    if (ch === "[") {
      const bracket = readBracket(state);
      if (!bracket.ok) return bracket;
      tokens.push(bracket.token);
      continue;
    }
    return { ok: false, error: `路径第 ${state.index + 1} 个字符「${ch}」无法识别` };
  }
  return { ok: true, tokens };
}

/** 执行查询并返回稳定的路径结果。 */
export function queryJson(value: unknown, query: string): QueryOutcome {
  const parsed = parseJsonPath(query);
  if (!parsed.ok) return parsed;
  return { ok: true, tokens: parsed.tokens, matches: executeTokens(value, parsed.tokens) };
}

/** 将路径格式化为可复制的 JSONPath。 */
export function formatJsonPath(path: readonly JsonPathSegment[]): string {
  let result = "$";
  for (const segment of path) {
    if (typeof segment === "number") {
      result += `[${segment}]`;
    } else if (/^[A-Za-z_$][\w$]*$/.test(segment)) {
      result += `.${segment}`;
    } else {
      result += `[${JSON.stringify(segment)}]`;
    }
  }
  return result;
}

function readBareKey(state: ParseState): string {
  const start = state.index;
  while (state.index < state.query.length && !".[".includes(state.query[state.index])) {
    state.index += 1;
  }
  return state.query.slice(start, state.index).trim();
}

function readBracket(
  state: ParseState,
): { ok: true; token: QueryToken } | { ok: false; error: string } {
  state.index += 1;
  while (state.query[state.index] === " ") state.index += 1;
  if (state.query[state.index] === "*") {
    state.index += 1;
    return closeBracket(state, { kind: "wildcard" });
  }
  const quote = state.query[state.index];
  if (quote === "'" || quote === '"') {
    const key = readQuoted(state, quote);
    if (key === null) return { ok: false, error: "方括号里的属性名引号没有闭合" };
    return closeBracket(state, { kind: "property", key });
  }
  const start = state.index;
  while (state.index < state.query.length && /\d/.test(state.query[state.index])) state.index += 1;
  if (start === state.index) return { ok: false, error: "方括号里需要数字下标、属性名或 *" };
  const index = Number(state.query.slice(start, state.index));
  return closeBracket(state, { kind: "index", index });
}

function closeBracket(
  state: ParseState,
  token: QueryToken,
): { ok: true; token: QueryToken } | { ok: false; error: string } {
  while (state.query[state.index] === " ") state.index += 1;
  if (state.query[state.index] !== "]") return { ok: false, error: "方括号缺少结束符 ]" };
  state.index += 1;
  return { ok: true, token };
}

function readQuoted(state: ParseState, quote: string): string | null {
  state.index += 1;
  let value = "";
  while (state.index < state.query.length) {
    const ch = state.query[state.index++];
    if (ch === quote) return value;
    if (ch === "\\" && state.index < state.query.length) {
      value += state.query[state.index++];
    } else {
      value += ch;
    }
  }
  return null;
}

function executeTokens(value: unknown, tokens: readonly QueryToken[]): QueryMatch[] {
  const matches: QueryMatch[] = [];
  visit(value, [], 0, tokens, matches);
  return matches;
}

function visit(
  value: unknown,
  path: JsonPathSegment[],
  tokenIndex: number,
  tokens: readonly QueryToken[],
  matches: QueryMatch[],
): void {
  if (tokenIndex >= tokens.length) {
    matches.push({ path, value });
    return;
  }
  const token = tokens[tokenIndex];
  if (token.kind === "recursive") {
    for (const [segment, child] of childrenOf(value)) {
      if (token.key === null || segment === token.key) {
        visit(child, [...path, segment], tokenIndex + 1, tokens, matches);
      }
      visit(child, [...path, segment], tokenIndex, tokens, matches);
    }
    return;
  }
  if (token.kind === "property") {
    if (isRecord(value) && Object.prototype.hasOwnProperty.call(value, token.key)) {
      visit(value[token.key], [...path, token.key], tokenIndex + 1, tokens, matches);
    }
    return;
  }
  if (token.kind === "index") {
    if (Array.isArray(value) && token.index < value.length) {
      visit(value[token.index], [...path, token.index], tokenIndex + 1, tokens, matches);
    }
    return;
  }
  for (const [segment, child] of childrenOf(value)) {
    visit(child, [...path, segment], tokenIndex + 1, tokens, matches);
  }
}

function childrenOf(value: unknown): Array<[JsonPathSegment, unknown]> {
  if (Array.isArray(value)) return value.map((child, index) => [index, child]);
  if (isRecord(value)) return Object.entries(value);
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
