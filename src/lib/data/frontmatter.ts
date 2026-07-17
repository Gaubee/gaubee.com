/**
 * Frontmatter 解析与序列化。
 *
 * 与旧 Astro 项目的 schema 对齐：
 * - title?: string（缺失时从正文 H1 或文件名推导）
 * - date: ISO datetime（必填）
 * - updated?: ISO datetime
 * - tags: string[]（默认 []）
 * - preview?/previewHTML?: string（运行时生成，不持久化）
 * - scripts?: string[]（customElements 按需加载，透传）
 * - __editor_metadata?: 编辑器字段 schema（透传）
 * - passthrough：允许任意额外字段
 */
import { dump as yamlDump, load as yamlLoad } from "js-yaml";

/** frontmatter 中编辑器管理的字段 schema。透传存储。 */
export interface MetadataFieldSchema {
  type:
    | "text"
    | "date"
    | "datetime"
    | "number"
    | "url"
    | "tel"
    | "color"
    | "object";
  isArray: boolean;
  order: number;
  description: string;
}

/** 标准化后的文章元数据。 */
export interface ArticleMetadata {
  title?: string;
  date: Date;
  updated?: Date;
  tags: string[];
  /** customElements 脚本路径。 */
  scripts?: string[];
  /** 编辑器字段 schema（透传，阶段 5 编辑器用）。 */
  __editor_metadata?: Record<string, MetadataFieldSchema>;
  /** 额外字段（passthrough）。 */
  [key: string]: unknown;
}

/** 解析 markdown 文件：分离 frontmatter 与正文。 */
export interface ParsedMarkdown {
  metadata: ArticleMetadata | null;
  body: string;
  /** 原始 frontmatter 文本（含 --- 分隔符），无 frontmatter 时为空。 */
  rawFrontmatter: string;
}

const FRONTMATTER_RE = /\A---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** 解析 markdown 文本为 frontmatter + body。 */
export function parseMarkdown(raw: string): ParsedMarkdown {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return { metadata: null, body: raw, rawFrontmatter: "" };
  }
  const rawFrontmatter = match[0];
  const body = raw.slice(match[0].length);
  let metadata: ArticleMetadata | null = null;
  try {
    const parsed = yamlLoad(match[1]) as Record<string, unknown> | null;
    if (parsed && typeof parsed === "object") {
      metadata = normalizeMetadata(parsed);
    }
  } catch {
    // frontmatter 解析失败时返回 null，保留 body
  }
  return { metadata, body, rawFrontmatter };
}

/** 把 frontmatter 对象 + body 序列化为完整 markdown 文本。 */
export function serializeMarkdown(
  metadata: ArticleMetadata,
  body: string,
): string {
  const fm = serializeFrontmatter(metadata);
  // frontmatter 结尾是 `---\n`，body 按原样拼接（parseMarkdown 已剥离前导空行）。
  // 保留 markdown 惯例：frontmatter 与 body 间一个空行。
  const trimmedBody = body.startsWith("\n") ? body : `\n${body}`;
  return `${fm}---${trimmedBody}`;
}

/** 序列化 frontmatter 为 YAML（含 --- 开头，不含结尾 ---）。 */
export function serializeFrontmatter(metadata: ArticleMetadata): string {
  // 去除运行时字段（preview/previewHTML 由管线重建，不写回）
  const { preview, previewHTML, ...rest } = metadata as ArticleMetadata & {
    preview?: unknown;
    previewHTML?: unknown;
  };
  void preview;
  void previewHTML;
  const yamlStr = yamlDump(rest, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  });
  return `---\n${yamlStr}`;
}

/**
 * 把原始 YAML 对象归一化为 ArticleMetadata（类型转换 + 默认值）。
 * 字段顺序完全跟随原文（JS 对象键按插入顺序保序），确保往返序列化不改变格式。
 */
export function normalizeMetadata(
  raw: Record<string, unknown>,
): ArticleMetadata {
  // 用 Record 构建（保证键顺序跟随 raw），最后断言为 ArticleMetadata
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (key === "preview" || key === "previewHTML") continue; // 运行时字段，丢弃
    if (key === "title") {
      if (typeof value === "string") result.title = value;
    } else if (key === "date") {
      const d = toDate(value);
      if (d) result.date = d;
    } else if (key === "updated") {
      const d = toDate(value);
      if (d) result.updated = d;
    } else if (key === "tags") {
      if (Array.isArray(value)) {
        result.tags = value.filter((t): t is string => typeof t === "string");
      }
    } else if (key === "scripts") {
      if (Array.isArray(value)) {
        result.scripts = value.filter(
          (t): t is string => typeof t === "string",
        );
      }
    } else if (key === "__editor_metadata") {
      if (value && typeof value === "object") {
        result.__editor_metadata = value;
      }
    } else {
      // 透传其余字段
      result[key] = value;
    }
  }

  // 补默认值（缺失时追加到末尾）
  if (!("date" in result)) result.date = new Date(0);
  if (!("tags" in result)) result.tags = [];

  return result as unknown as ArticleMetadata;
}

function toDate(value: unknown): Date | undefined {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return undefined;
}

/**
 * 文章 ID 规范：文件名 `{4位序号}.{kebab-case-slug}.md`。
 * 从文件名提取序号与 slug。
 */
export interface ArticleId {
  /** 序号字符串，如 "0057"。 */
  seq: string;
  /** 英文 slug，如 "tc39-signals"。老文章可能为空。 */
  slug: string;
  /** 完整文件名（不含扩展名），如 "0057.tc39-signals"。 */
  stem: string;
}

const ID_RE = /^(\d+)\.(.+)$/;

export function parseArticleId(filename: string): ArticleId {
  const stem = filename.replace(/\.md$/, "");
  const match = stem.match(ID_RE);
  if (match) {
    return { seq: match[1], slug: match[2], stem };
  }
  // 纯数字文件名（老文章）
  if (/^\d+$/.test(stem)) {
    return { seq: stem, slug: "", stem };
  }
  return { seq: "", slug: stem, stem };
}

/** 内容类型：article（长文）或 event（短评/时事快讯）。 */
export type Collection = "articles" | "events";

/** 根据序号位数推断集合（articles 用 4 位，events 用 5 位）。 */
export function inferCollection(seq: string): Collection {
  return seq.length >= 5 ? "events" : "articles";
}
