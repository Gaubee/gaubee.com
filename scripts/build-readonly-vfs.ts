#!/usr/bin/env node
/**
 * 构建时脚本：把 src/content 下的 markdown 预解析为「轻量元数据索引」，
 * 生成 src/lib/vfs/readonly-data.ts（轻量元数据索引）。
 *
 * 启动性能（2026-11-28 实测）：
 * - 旧实现把全部正文内联成 readonly-data.ts，首屏同步下载 11.36MB（gzip 1.8MB）
 *   并在启动时全量解析 1509 篇 markdown，冷启动被拖到 5.8s。
 * - 现在只内联列表/摘要所需的元数据（约 1MB，gzip 130KB），正文按需从
 *   /pages/raw/<collection>/<filename> 拉取（contentQuery.readBody）。
 *
 * 用法：tsx scripts/build-readonly-vfs.ts（由 pnpm content:prepare 调用）
 */

import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { createExcerpt } from "../src/lib/content-pipeline/excerpt";
import { parseArticleId, parseMarkdown } from "../src/lib/data/frontmatter";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const CONTENT_DIR = join(__dirname, "..", "src", "content");
const OUTPUT_FILE = join(__dirname, "..", "src", "lib", "vfs", "readonly-data.ts");

interface ReadonlyIndexEntry {
  path: string;
  collection: "articles" | "events";
  filename: string;
  id: { seq: string; slug: string; stem: string };
  title: string;
  date: string;
  updated?: string;
  tags: string[];
  excerpt: string;
  metadata: Record<string, unknown>;
}

/** 读取指定集合目录下的 .md 文件（content 只有 articles/events 两个集合）。 */
async function readCollection(collection: "articles" | "events"): Promise<ReadonlyIndexEntry[]> {
  const dir = join(CONTENT_DIR, collection);
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }

  const entries: ReadonlyIndexEntry[] = [];
  for (const filename of files) {
    const raw = await readFile(join(dir, filename), "utf-8");
    const { metadata, body } = parseMarkdown(raw);
    const meta = (metadata ?? { date: new Date(0), tags: [] }) as Record<string, unknown> & {
      date: Date;
      updated?: Date;
      tags: string[];
    };
    const articleId = parseArticleId(filename);

    entries.push({
      path: `src/content/${collection}/${filename}`,
      collection,
      filename,
      id: articleId,
      title: (meta.title as string | undefined) ?? articleId.slug ?? articleId.stem,
      date: meta.date.toISOString(),
      updated: meta.updated?.toISOString(),
      tags: meta.tags,
      excerpt: createExcerpt(body),
      // Date 会被 JSON.stringify 序列化为 ISO 字符串，运行时再转回 Date
      metadata: meta as unknown as Record<string, unknown>,
    });
  }
  return entries;
}

async function main() {
  console.log("🔧 构建只读 VFS 元数据索引...");

  const entries = [...(await readCollection("articles")), ...(await readCollection("events"))];
  console.log(`📄 索引 ${entries.length} 个 markdown 文件`);

  const tsContent = `/**
 * 只读 VFS 元数据索引 —— 构建时自动生成。
 *
 * 由 scripts/build-readonly-vfs.ts 生成，不要手动修改。
 * 只包含列表/摘要所需字段（无正文）；正文按需从 /pages/raw/ 拉取。
 */

export interface ReadonlyIndexEntry {
  path: string;
  collection: "articles" | "events";
  filename: string;
  id: { seq: string; slug: string; stem: string };
  title: string;
  date: string;
  updated?: string;
  tags: string[];
  excerpt: string;
  metadata: Record<string, unknown>;
}

export const readonlyIndex: ReadonlyIndexEntry[] = ${JSON.stringify(entries, null, 2)};
`;

  await writeFile(OUTPUT_FILE, tsContent, "utf-8");
  console.log(`✅ 已生成 ${relative(join(__dirname, ".."), OUTPUT_FILE)}`);
  console.log(`   包含 ${entries.length} 条元数据`);
}

main().catch((err) => {
  console.error("❌ 构建失败:", err);
  process.exit(1);
});
