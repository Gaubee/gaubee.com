/**
 * 正交意图：
 * 1. 原始需求（2026-11）：浏览器内置 AI 与 WebMCP 共用同一套站内只读工具。
 * 2. search_site 走 /api/search 混合检索；read_article 只读构建期 VFS，拒绝任意 URL。
 * 3. 统一输入校验、8s 超时与 AbortSignal，保证页面内 Agent 与外部调用行为一致。
 */
import { parseArticleId, parseMarkdown } from "$lib/data/frontmatter";
import { readonlyFiles } from "$lib/vfs/readonly-data";

export const TOOL_TIMEOUT_MS = 8_000;

const SEARCH_ENDPOINT = "/api/search";
const MAX_SEARCH_RESULTS = 5;
const DEFAULT_SEARCH_LIMIT = 5;
const MAX_EXCERPT_CHARS = 300;
const DEFAULT_ARTICLE_CHARS = 1_200;
const MAX_ARTICLE_CHARS = 1_500;
/** 只允许读取构建期 VFS 中的 markdown，禁止任意 URL / 路径。 */
const ARTICLE_ID_RE = /^src\/content\/(articles|events)\/[^/]+\.md$/;

const searchSiteSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    query: { type: "string", description: "站内搜索关键词或自然语言问题" },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: MAX_SEARCH_RESULTS,
      description: "返回条数，默认 5",
    },
  },
  required: ["query"],
  additionalProperties: false,
};

const readArticleSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    id: {
      type: "string",
      description: "search_site 返回的 id，形如 src/content/articles/0001.xxx.md",
    },
    maxChars: {
      type: "integer",
      minimum: 1,
      maximum: MAX_ARTICLE_CHARS,
      description: "正文最大字符数，默认 1200",
    },
  },
  required: ["id"],
  additionalProperties: false,
};

export type SiteToolName = "search_site" | "read_article";

/** 返回给模型/WebMCP 的搜索结果（只含公开字段）。 */
export interface SiteSearchResult {
  id: string;
  title: string;
  href: string;
  excerpt: string;
  date: number;
  appName: string;
}

export interface SearchSiteToolResult {
  query: string;
  results: SiteSearchResult[];
}

export interface ReadArticleToolResult {
  id: string;
  title: string;
  href: string;
  text: string;
  truncated: boolean;
}

export interface ReadArticleNotFound {
  error: "not_found";
}

export type ReadArticleResult = ReadArticleToolResult | ReadArticleNotFound;

/** 两条通道共用的工具描述（WebMCP 注册与 Agent prompt 都从这里取）。 */
export interface SiteToolDefinition {
  name: SiteToolName;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: true; untrustedContentHint: true };
  execute(input: unknown, options?: { signal?: AbortSignal }): Promise<unknown>;
}

export const SITE_TOOLS: readonly SiteToolDefinition[] = [
  {
    name: "search_site",
    description:
      "搜索 gaubee.com 的文章与事件（混合检索）。返回最多 5 条结果，包含 id、标题、链接、摘要与日期。",
    inputSchema: searchSiteSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: (input, options) => callTool("search_site", input, options?.signal),
  },
  {
    name: "read_article",
    description:
      "读取 gaubee.com 文章/事件的正文纯文本。id 必须来自 search_site 的返回结果，不能传 URL 或任意路径。",
    inputSchema: readArticleSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: (input, options) => callTool("read_article", input, options?.signal),
  },
];

export function callTool(
  name: "search_site",
  args: unknown,
  signal?: AbortSignal,
): Promise<SearchSiteToolResult>;
export function callTool(
  name: "read_article",
  args: unknown,
  signal?: AbortSignal,
): Promise<ReadArticleResult>;
export function callTool(
  name: SiteToolName,
  args: unknown,
  signal?: AbortSignal,
): Promise<SearchSiteToolResult | ReadArticleResult>;
export async function callTool(
  name: SiteToolName,
  args: unknown,
  signal?: AbortSignal,
): Promise<SearchSiteToolResult | ReadArticleResult> {
  const input = requireRecord(args);
  if (name === "search_site") return searchSite(input, signal);
  if (name === "read_article") return readArticle(input, signal);
  throw new Error(`未知工具：${String(name)}`);
}

async function searchSite(
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<SearchSiteToolResult> {
  const rawQuery = args.query;
  if (typeof rawQuery !== "string" || !rawQuery.trim()) {
    throw new Error("query 不能为空");
  }
  const query = rawQuery.trim();
  const limit = clampInteger(args.limit, DEFAULT_SEARCH_LIMIT, 1, MAX_SEARCH_RESULTS);
  throwIfAborted(signal);

  const timeout = createTimeoutSignal(signal, TOOL_TIMEOUT_MS);
  try {
    const response = await fetch(SEARCH_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q: query, limit, mode: "hybrid" }),
      signal: timeout.signal,
    });
    if (!response.ok) throw new Error(`搜索服务返回 ${response.status}`);
    const payload: unknown = await response.json();
    if (!isRecord(payload) || !Array.isArray(payload.results)) {
      throw new Error("搜索服务响应格式错误");
    }
    const results: SiteSearchResult[] = [];
    for (const item of payload.results) {
      const result = toSiteSearchResult(item);
      if (result) results.push(result);
      if (results.length >= limit) break;
    }
    return { query, results };
  } catch (cause) {
    if (timeout.didTimeout()) {
      throw new Error(`搜索请求超时（${TOOL_TIMEOUT_MS / 1000}s）`);
    }
    throw cause;
  } finally {
    timeout.cleanup();
  }
}

async function readArticle(
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ReadArticleResult> {
  throwIfAborted(signal);
  const id = args.id;
  if (typeof id !== "string" || !ARTICLE_ID_RE.test(id) || id.includes("..")) {
    throw new Error("id 必须匹配 src/content/(articles|events)/<name>.md");
  }
  const maxChars = clampInteger(args.maxChars, DEFAULT_ARTICLE_CHARS, 1, MAX_ARTICLE_CHARS);
  const raw = Object.prototype.hasOwnProperty.call(readonlyFiles, id)
    ? readonlyFiles[id]
    : undefined;
  if (typeof raw !== "string") return { error: "not_found" };

  const { metadata, body } = parseMarkdown(raw);
  const filename = id.split("/").pop() ?? id;
  const collection = id.includes("/articles/") ? "articles" : "events";
  const articleId = parseArticleId(filename);
  const title = metadata?.title?.trim() || extractHeading(body) || articleId.slug || articleId.stem;
  const clipped = truncateChars(stripMarkup(body), maxChars);

  return {
    id,
    title,
    href: `/article/${collection}/${articleId.stem}`,
    text: clipped.text,
    truncated: clipped.truncated,
  };
}

function toSiteSearchResult(item: unknown): SiteSearchResult | null {
  if (!isRecord(item)) return null;
  const { id, title, href } = item;
  if (typeof id !== "string" || typeof title !== "string" || typeof href !== "string") {
    return null;
  }
  // 只接受站内绝对路径，避免把外部/伪协议链接带进 UI。
  if (!href.startsWith("/") || href.startsWith("//")) return null;
  const excerpt = typeof item.excerpt === "string" ? item.excerpt : "";
  const date = typeof item.date === "number" && Number.isFinite(item.date) ? item.date : 0;
  const appName = typeof item.appName === "string" ? item.appName : "内容";
  return {
    id,
    title,
    href,
    excerpt: truncateChars(excerpt, MAX_EXCERPT_CHARS).text,
    date,
    appName,
  };
}

/** 去掉 frontmatter 之外的 HTML 标签/注释，并压缩多余空白；保留 markdown 语义。 */
function stripMarkup(body: string): string {
  return body
    .replace(/\r\n?/g, "\n")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractHeading(body: string): string {
  const match = body.match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/m);
  return match?.[1]?.replace(/#+\s*$/, "").trim() ?? "";
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("工具参数必须是对象");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** 按码点截断，避免把代理对切坏。 */
function truncateChars(text: string, max: number): { text: string; truncated: boolean } {
  const chars = Array.from(text);
  if (chars.length <= max) return { text, truncated: false };
  return { text: chars.slice(0, max).join(""), truncated: true };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("已取消", "AbortError");
}

/** 把外部取消与工具自身的超时合并成一个 AbortSignal。 */
function createTimeoutSignal(
  signal: AbortSignal | undefined,
  ms: number,
): { signal: AbortSignal; didTimeout: () => boolean; cleanup: () => void } {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ms);
  const abort = () => controller.abort();
  if (signal) {
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  }
  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    },
  };
}
