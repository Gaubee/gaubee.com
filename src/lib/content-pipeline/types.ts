/**
 * 内容管道核心类型。
 *
 * 统一内容数据模型（取代 ReadonlyPost + Post 双轨）：
 * - 扁平快捷字段（title/date/updated/tags/excerpt）方便消费方直接读取。
 * - 保留结构化 articleId（{seq, slug, stem}）与类型化 metadata（ArticleMetadata），
 *   兼容现有消费方的 post.id.stem / post.metadata.ai 等访问方式（约束 3）。
 * - excerpt 由管道统一生成（替代 4 份散落的 excerpt 实现）。
 *
 * 数据流：
 *   VFS 存储层（readonlyVfs + ZenFS）
 *       ↓ 读原始数据
 *   ContentSource（读 VFS → ContentEntry[]）
 *       ↓ 消费产物
 *   ContentProcessor（ContentEntry[] → ProcessResult）
 *       ↓ 消费产物
 *   内容查询层（contentQuery: listArticles/listTags/findPost/excerptFor）
 *       ↓ 统一查询
 *   消费层（Views/Widgets）
 */
import type { ArticleMetadata, ArticleId } from "$lib/data/frontmatter";

/** 统一内容数据模型。 */
export interface ContentEntry {
  /** 唯一标识（= 完整 path，用作 Map key 与缓存键）。 */
  uid: string;
  /** 文件在仓库的完整路径，如 'src/content/articles/0057.tc39-signals.md'。 */
  path: string;
  /** 集合：'articles' | 'events'（字符串以支持第三方扩展）。 */
  collection: string;
  /** 文件名（含 .md）。兼容 ReadonlyPost.filename。 */
  filename: string;
  /** 解析后的文章 id。兼容 post.id.stem / post.id.slug。 */
  id: ArticleId;
  /** ★ 扁平快捷：标题（缺失时从 slug/stem 推导）。 */
  title: string;
  /** ★ 扁平快捷：发布日期。 */
  date: Date;
  /** ★ 扁平快捷：更新日期。 */
  updated?: Date;
  /** ★ 扁平快捷：标签数组。 */
  tags: string[];
  /** 正文（不含 frontmatter）。 */
  body: string;
  /** ★ 统一摘要（去 markdown 符号 + 限 180 字符）。替代散落的 excerpt 实现。 */
  excerpt: string;
  /** 类型化元数据（含 ai/scripts/__editor_metadata 等扩展字段）。 */
  metadata: ArticleMetadata;
}

/** VFS 只读访问器（管道与具体存储解耦的抽象）。 */
export interface VfsReader {
  /** 读取文件内容，不存在返回 null。 */
  readFile(path: string): string | null;
  /** 列出某前缀下的所有文件路径（递归）。 */
  readdir(prefix: string): string[];
}

/** 内容源：把某集合的原始 VFS 文件解析为 ContentEntry[]。 */
export interface ContentSource {
  /** 集合名（与 ContentEntry.collection 对应）。 */
  collection: string;
  /** VFS 路径前缀（如 'src/content/articles/'）。 */
  pathPrefix: string;
  /** 读取并解析。 */
  read(vfs: VfsReader): ContentEntry[];
}

/** 处理器产物：可被查询层或其他消费方消费的派生数据。 */
export interface ProcessResult {
  /** 产物 id（与 processor id 对应）。 */
  id: string;
  /** 产物数据。 */
  data: unknown;
  /** 产物类型标签（如 'tags' | 'search-index'）。 */
  type: string;
}

/** 内容处理器：把 entry 列表加工为派生产物。 */
export interface ContentProcessor {
  /** 处理器 id（唯一，用作缓存键）。 */
  id: string;
  /** 处理产物类型标签。 */
  type: string;
  /** 处理。 */
  process(entries: ContentEntry[]): ProcessResult;
}
