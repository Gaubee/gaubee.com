/**
 * ContentSource 共享工具：从 VFS 读取某集合下的所有 markdown 文件并解析为 ContentEntry[]。
 *
 * 复用 parseMarkdown / parseArticleId（不重写解析逻辑，约束 2）。
 * 替代 src/lib/vfs/readonly.ts 的 parseNode + getPosts 的职责。
 */
import { parseArticleId, parseMarkdown } from "$lib/data/frontmatter";

import { createExcerpt } from "../excerpt";
import type { ContentEntry, VfsReader } from "../types";

/** 默认元数据（解析失败时回退）。 */
const FALLBACK_DATE = new Date(0);

export interface CollectionSourceOptions {
  /** 集合名（如 'articles' / 'events'）。 */
  collection: string;
  /** VFS 路径前缀（如 'src/content/articles/'）。 */
  pathPrefix: string;
}

/** 构造一个读取指定集合的 ContentSource.read 实现。 */
export function readCollection(vfs: VfsReader, opts: CollectionSourceOptions): ContentEntry[] {
  const paths = vfs.readdir(opts.pathPrefix).filter((p) => p.endsWith(".md"));
  const entries: ContentEntry[] = [];

  for (const path of paths) {
    const raw = vfs.readFile(path);
    if (raw === null) continue;

    const filename = path.split("/").pop() ?? path;
    const { metadata, body } = parseMarkdown(raw);
    const meta = metadata ?? { date: FALLBACK_DATE, tags: [] };
    const articleId = parseArticleId(filename);

    entries.push({
      uid: path,
      path,
      collection: opts.collection,
      filename,
      id: articleId,
      title: meta.title ?? articleId.slug ?? articleId.stem,
      date: meta.date,
      updated: meta.updated,
      tags: meta.tags,
      body,
      excerpt: createExcerpt(body),
      metadata: meta,
    });
  }

  return entries;
}
