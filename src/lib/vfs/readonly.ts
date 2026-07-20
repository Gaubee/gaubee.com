/**
 * 只读虚拟文件系统（ReadonlyVFS）—— 构建时生成的静态数据。
 *
 * 设计目标：
 * - 存储构建时预解析的文章/说说数据（frontmatter + body）。
 * - 无需 IndexedDB / GitHub API，纯内存读取，零延迟。
 * - 数据由构建脚本（scripts/build-readonly-vfs.ts）从 src/content 生成。
 * - 只读：不提供 write/unlink/commit 等修改接口。
 */

import { parseMarkdown, parseArticleId, type ArticleMetadata } from "$lib/data/frontmatter";

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** 只读文件节点（简化版 VfsNode，无 dirty/sha/origin/mtime）。 */
export interface ReadonlyNode {
  path: string;
  content: string;
}

/** 解析后的内容记录。 */
export interface ReadonlyPost {
  path: string;
  collection: "articles" | "events";
  filename: string;
  id: { seq: string; slug: string; stem: string };
  metadata: ArticleMetadata;
  body: string;
}

// ---------------------------------------------------------------------------
// 数据注入点（构建时由脚本填充）
// ---------------------------------------------------------------------------

/**
 * 构建时生成的文件映射。
 * key: 文件路径（如 'src/content/articles/0057.tc39-signals.md'）
 * value: 文件内容（原始 markdown 文本）
 */
declare const __READONLY_FILES__: Record<string, string>;

// ---------------------------------------------------------------------------
// 运行时初始化
// ---------------------------------------------------------------------------

/** 内存中的文件映射（延迟初始化）。 */
let fileMap: Map<string, string> | null = null;

/** 解析后的 posts 缓存（延迟初始化）。 */
let postsCache: ReadonlyPost[] | null = null;

function initFileMap(): Map<string, string> {
  if (fileMap) return fileMap;
  fileMap = new Map();
  
  // 尝试读取构建时注入的数据
  try {
    const data = (globalThis as unknown as Record<string, unknown>).__READONLY_FILES__;
    if (data && typeof data === "object") {
      for (const [path, content] of Object.entries(data)) {
        if (typeof content === "string") {
          fileMap.set(path, content);
        }
      }
    }
  } catch {
    // 构建时数据未注入，忽略
  }
  
  return fileMap;
}

function collectionFromPath(path: string): "articles" | "events" | null {
  if (path.startsWith("src/content/articles/")) return "articles";
  if (path.startsWith("src/content/events/")) return "events";
  return null;
}

/** 解析单个文件为 ReadonlyPost。 */
function parseNode(path: string, content: string): ReadonlyPost | null {
  const collection = collectionFromPath(path);
  if (!collection) return null;
  
  const filename = path.split("/").pop() ?? path;
  const { metadata, body } = parseMarkdown(content);
  
  return {
    path,
    collection,
    filename,
    id: parseArticleId(filename),
    metadata: metadata ?? { date: new Date(0), tags: [] },
    body,
  };
}

// ---------------------------------------------------------------------------
// 核心 API（类 Unix 接口，与 Vfs 对齐）
// ---------------------------------------------------------------------------

export class ReadonlyVfs {
  /** 读取文件内容。 */
  readFile(path: string): string | null {
    const map = initFileMap();
    return map.get(path) ?? null;
  }

  /** 列出某前缀下的文件。 */
  readdir(prefix = "", opts: { recursive?: boolean } = {}): ReadonlyNode[] {
    const recursive = opts.recursive ?? true;
    const map = initFileMap();
    const p = prefix.replace(/\/+$/, "");
    const prefixWithSlash = p ? `${p}/` : "";
    
    const results: ReadonlyNode[] = [];
    for (const [path, content] of map) {
      if (p && !path.startsWith(prefixWithSlash)) continue;
      if (!recursive) {
        const rest = path.slice(prefixWithSlash.length);
        if (rest.includes("/")) continue;
      }
      results.push({ path, content });
    }
    
    return results.sort((a, b) => a.path.localeCompare(b.path));
  }

  /** 获取文件元数据（简化版，无 sha/dirty/mtime）。 */
  stat(path: string): ReadonlyNode | null {
    const map = initFileMap();
    const content = map.get(path);
    return content !== undefined ? { path, content } : null;
  }

  /** 获取所有解析后的 posts（缓存）。 */
  getPosts(): ReadonlyPost[] {
    if (postsCache) return postsCache;
    
    const map = initFileMap();
    const posts: ReadonlyPost[] = [];
    for (const [path, content] of map) {
      const post = parseNode(path, content);
      if (post) posts.push(post);
    }
    
    postsCache = posts;
    return postsCache;
  }

  /** 按 collection 筛选 posts。 */
  getPostsByCollection(collection: "articles" | "events"): ReadonlyPost[] {
    return this.getPosts().filter((p) => p.collection === collection);
  }

  /** 根据 collection + stem 查找单篇。 */
  findPost(collection: "articles" | "events", stem: string): ReadonlyPost | undefined {
    return this.getPosts().find((p) => p.collection === collection && p.id.stem === stem);
  }

  /** 清空缓存（调试用）。 */
  clearCache(): void {
    postsCache = null;
  }
}

/** 单例。 */
export const readonlyVfs = new ReadonlyVfs();
