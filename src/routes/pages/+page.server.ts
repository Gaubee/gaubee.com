/**
 * 阅读站首页：构建时读 src/content 下所有 markdown，返回文章列表。
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseMarkdown, parseArticleId, type Collection } from "$lib/data/frontmatter";

export const prerender = true;

interface FeedPost {
  collection: Collection;
  stem: string;
  title: string;
  date: string;
  tags: string[];
  /** 正文前 200 字符（预览用）。 */
  excerpt: string;
}

export async function load(): Promise<{ posts: FeedPost[] }> {
  const collections: Collection[] = ["articles", "events"];
  const posts: FeedPost[] = [];

  for (const collection of collections) {
    const dir = join(process.cwd(), "src/content", collection);
    let files: string[];
    try {
      const { readdir } = await import("node:fs/promises");
      files = await readdir(dir);
    } catch {
      continue;
    }
    for (const filename of files.filter((f) => f.endsWith(".md"))) {
      try {
        const raw = await readFile(join(dir, filename), "utf-8");
        const { metadata, body } = parseMarkdown(raw);
        posts.push({
          collection,
          stem: parseArticleId(filename).stem,
          title: metadata?.title ?? parseArticleId(filename).stem,
          date: (metadata?.date ?? new Date(0)).toISOString(),
          tags: metadata?.tags ?? [],
          excerpt: body.replace(/[#*>`\[\]()!-]/g, "").replace(/\s+/g, " ").trim().slice(0, 200),
        });
      } catch (e) {
        console.warn(`读取 ${filename} 失败`, e);
      }
    }
  }

  posts.sort((a, b) => b.date.localeCompare(a.date));
  return { posts };
}
