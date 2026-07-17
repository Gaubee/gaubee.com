import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  parseMarkdown,
  parseArticleId,
  type Collection,
} from "$lib/data/frontmatter";

export const prerender = true;

export async function load() {
  const collections: Collection[] = ["articles", "events"];
  const posts: Array<{
    collection: Collection;
    stem: string;
    title: string;
    date: string;
  }> = [];
  for (const collection of collections) {
    const dir = join(process.cwd(), "src/content", collection);
    let files: string[] = [];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }
    for (const filename of files.filter((f) => f.endsWith(".md"))) {
      const raw = await readFile(join(dir, filename), "utf-8");
      const { metadata } = parseMarkdown(raw);
      posts.push({
        collection,
        stem: parseArticleId(filename).stem,
        title: metadata?.title ?? parseArticleId(filename).stem,
        date: (metadata?.date ?? new Date(0)).toISOString(),
      });
    }
  }
  posts.sort((a, b) => b.date.localeCompare(a.date));
  return { posts };
}
