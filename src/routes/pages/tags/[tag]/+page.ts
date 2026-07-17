import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { parseMarkdown } from "$lib/data/frontmatter";

export const prerender = true;

/** 枚举所有 tag（去重）作为预渲染路径。 */
export async function entries() {
  const tags = new Set<string>();
  for (const c of ["articles", "events"]) {
    const dir = join(process.cwd(), "src/content", c);
    let files: string[] = [];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }
    for (const f of files.filter((x) => x.endsWith(".md"))) {
      const { metadata } = parseMarkdown(await readFile(join(dir, f), "utf-8"));
      for (const t of metadata?.tags ?? []) tags.add(t);
    }
  }
  return [...tags].map((tag) => ({ tag: encodeURIComponent(tag) }));
}
