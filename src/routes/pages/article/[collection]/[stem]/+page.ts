import { readdir } from "node:fs/promises";
import { join } from "node:path";

export const prerender = true;

/** 构建时枚举所有文章路径，供预渲染器发现动态路由。 */
export async function entries() {
  const collections = ["articles", "events"] as const;
  const out: Array<{ collection: string; stem: string }> = [];
  for (const c of collections) {
    const dir = join(process.cwd(), "src/content", c);
    let files: string[] = [];
    try {
      files = await readdir(dir);
    } catch {
      continue;
    }
    for (const f of files.filter((x) => x.endsWith(".md"))) {
      out.push({ collection: c, stem: f.replace(/\.md$/, "") });
    }
  }
  return out;
}
