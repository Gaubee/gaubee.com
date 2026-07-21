/**
 * 正交意图：
 * 1. 原始需求（2026-07-21）：搜索应用处理 Lucene 表达式并生成结构化任务。
 * 2. 支持 app、title、tags、content 字段，以及 AND/OR/NOT/括号/短语。
 */
import MiniSearch, { type Query, type QueryCombination } from "minisearch";
import type { SearchQuery } from "./types";

type TokenKind =
  | "word"
  | "phrase"
  | "and"
  | "or"
  | "not"
  | "colon"
  | "left-paren"
  | "right-paren";

interface Token {
  kind: TokenKind;
  value: string;
}

type LuceneNode =
  | { type: "term"; value: string; field?: string }
  | { type: "and" | "or"; children: LuceneNode[] }
  | { type: "not"; child: LuceneNode };

interface QueryPlan {
  positive: Query | null;
  negative: Query[];
}

const SEARCHABLE_FIELDS = new Set(["title", "tags", "content"]);

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let cursor = 0;

  while (cursor < source.length) {
    const character = source[cursor];
    if (/\s/.test(character)) {
      cursor += 1;
      continue;
    }
    if (character === ":") {
      tokens.push({ kind: "colon", value: character });
      cursor += 1;
      continue;
    }
    if (character === "(") {
      tokens.push({ kind: "left-paren", value: character });
      cursor += 1;
      continue;
    }
    if (character === ")") {
      tokens.push({ kind: "right-paren", value: character });
      cursor += 1;
      continue;
    }
    if (character === '"') {
      const end = source.indexOf('"', cursor + 1);
      if (end === -1) throw new Error("Lucene 短语缺少结束引号");
      tokens.push({ kind: "phrase", value: source.slice(cursor + 1, end) });
      cursor = end + 1;
      continue;
    }

    const match = source.slice(cursor).match(/^[^\s:()"]+/);
    if (!match) throw new Error("Lucene 查询包含无法识别的字符");
    const value = match[0];
    const upper = value.toUpperCase();
    tokens.push({
      kind:
        upper === "AND"
          ? "and"
          : upper === "OR"
            ? "or"
            : upper === "NOT"
              ? "not"
              : "word",
      value,
    });
    cursor += value.length;
  }

  return tokens;
}

class Parser {
  private cursor = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  parse(): LuceneNode | null {
    if (this.tokens.length === 0) return null;
    const expression = this.parseOr();
    if (this.peek())
      throw new Error(`Lucene 查询在 “${this.peek()!.value}” 后缺少操作符`);
    return expression;
  }

  private parseOr(): LuceneNode {
    const children = [this.parseAnd()];
    while (this.consume("or")) children.push(this.parseAnd());
    return children.length === 1 ? children[0] : { type: "or", children };
  }

  private parseAnd(): LuceneNode {
    const children = [this.parseUnary()];
    while (true) {
      if (this.consume("and")) {
        children.push(this.parseUnary());
      } else if (this.startsUnary(this.peek())) {
        children.push(this.parseUnary());
      } else {
        break;
      }
    }
    return children.length === 1 ? children[0] : { type: "and", children };
  }

  private parseUnary(): LuceneNode {
    if (this.consume("not")) return { type: "not", child: this.parseUnary() };
    return this.parsePrimary();
  }

  private parsePrimary(): LuceneNode {
    if (this.consume("left-paren")) {
      const expression = this.parseOr();
      if (!this.consume("right-paren"))
        throw new Error("Lucene 分组缺少右括号");
      return expression;
    }

    const term = this.consumeOne("word", "phrase");
    if (!term) throw new Error("Lucene 查询缺少搜索词");
    if (!this.consume("colon")) return { type: "term", value: term.value };

    const value = this.parsePrimary();
    return withField(value, term.value.toLowerCase());
  }

  private startsUnary(token: Token | undefined): boolean {
    return (
      token?.kind === "word" ||
      token?.kind === "phrase" ||
      token?.kind === "left-paren" ||
      token?.kind === "not"
    );
  }

  private consume(kind: TokenKind): boolean {
    if (this.peek()?.kind !== kind) return false;
    this.cursor += 1;
    return true;
  }

  private consumeOne(...kinds: TokenKind[]): Token | undefined {
    const token = this.peek();
    if (!token || !kinds.includes(token.kind)) return undefined;
    this.cursor += 1;
    return token;
  }

  private peek(): Token | undefined {
    return this.tokens[this.cursor];
  }
}

function withField(node: LuceneNode, field: string): LuceneNode {
  if (node.type === "term") return { ...node, field };
  if (node.type === "not")
    return { type: "not", child: withField(node.child, field) };
  return {
    ...node,
    children: node.children.map((child) => withField(child, field)),
  };
}

function collectAppFilters(
  node: LuceneNode,
  negated: boolean,
  include: Set<string>,
  exclude: Set<string>,
): void {
  if (node.type === "term") {
    if (node.field === "app") (negated ? exclude : include).add(node.value);
    return;
  }
  if (node.type === "not") {
    collectAppFilters(node.child, !negated, include, exclude);
    return;
  }
  for (const child of node.children)
    collectAppFilters(child, negated, include, exclude);
}

function join(
  operator: QueryCombination["combineWith"],
  queries: Query[],
): Query | null {
  if (queries.length === 0) return null;
  if (queries.length === 1) return queries[0];
  return { combineWith: operator, queries };
}

function planToQuery(plan: QueryPlan): Query {
  const base = plan.positive ?? MiniSearch.wildcard;
  return plan.negative.length === 0
    ? base
    : { combineWith: "AND_NOT", queries: [base, ...plan.negative] };
}

function toPlan(node: LuceneNode): QueryPlan {
  if (node.type === "term") {
    if (node.field === "app") return { positive: null, negative: [] };
    if (node.field && !SEARCHABLE_FIELDS.has(node.field)) {
      throw new Error(`不支持 Lucene 字段 “${node.field}”`);
    }
    const positive: Query = node.field
      ? { combineWith: "OR", fields: [node.field], queries: [node.value] }
      : node.value;
    return { positive, negative: [] };
  }
  if (node.type === "not") {
    const child = toPlan(node.child);
    return { positive: null, negative: [planToQuery(child)] };
  }
  if (node.type === "or") {
    const alternatives = node.children.map((child) =>
      planToQuery(toPlan(child)),
    );
    return { positive: join("OR", alternatives), negative: [] };
  }

  const plans = node.children.map(toPlan);
  return {
    positive: join(
      "AND",
      plans.flatMap((plan) => (plan.positive ? [plan.positive] : [])),
    ),
    negative: plans.flatMap((plan) => plan.negative),
  };
}

/** 解析用户输入的 Lucene 表达式，生成可分发的搜索任务。 */
export function parseLuceneQuery(source: string): SearchQuery {
  const expression = new Parser(tokenize(source.trim())).parse();
  if (!expression) {
    return { source, includeAppIds: [], excludeAppIds: [], engineQuery: null };
  }

  const include = new Set<string>();
  const exclude = new Set<string>();
  collectAppFilters(expression, false, include, exclude);

  return {
    source,
    includeAppIds: [...include].sort(),
    excludeAppIds: [...exclude].sort(),
    engineQuery: planToQuery(toPlan(expression)),
  };
}
