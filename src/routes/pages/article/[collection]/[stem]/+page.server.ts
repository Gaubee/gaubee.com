import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { error } from "@sveltejs/kit";
import { parseMarkdown, type Collection } from "$lib/data/frontmatter";
import { ensureShikiLoaded, renderMarkdown } from "$lib/markdown/render";

export const prerender = true;

interface ArticleData {
  collection: Collection;
  stem: string;
  title: string;
  date: string;
  updated: string | null;
  tags: string[];
  /** 预渲染的 HTML（含 Shiki 代码高亮）。 */
  html: string;
  /** 原始 markdown（供 raw 端点 / 查看 source）。 */
  raw: string;
}

export async function load({ params }): Promise<ArticleData> {
  const { collection, stem } = params;
  if (collection !== "articles" && collection !== "events") {
    error(404, "Not found");
  }
  const filePath = join(process.cwd(), "src/content", collection, `${stem}.md`);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch {
    error(404, "Article not found");
  }
  const { metadata, body } = parseMarkdown(raw);
  // 确保 Shiki highlighter 已加载（构建期一次性），再同步渲染（代码块才能高亮）
  await ensureShikiLoaded();
  const html = renderMarkdown(body);
  return {
    collection,
    stem,
    title: metadata?.title ?? stem,
    date: (metadata?.date ?? new Date(0)).toISOString(),
    updated: metadata?.updated ? metadata.updated.toISOString() : null,
    tags: metadata?.tags ?? [],
    html,
    raw,
  };
}
