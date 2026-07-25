#!/usr/bin/env node
/**
 * 正交意图：
 * 1. 原始需求（2026-07-21）：按应用和时间拆分约 500 KiB 搜索索引文件。
 * 2. 从与 ReadonlyVFS 相同的 src/content Markdown 构建 MiniSearch 静态分片。
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { createExcerpt } from "../src/lib/content-pipeline/excerpt";
import {
  entryToSearchDocument,
  sortSearchDocuments,
} from "../src/lib/content-pipeline/processors/search-index";
import { parseArticleId, parseMarkdown } from "../src/lib/data/frontmatter";
import type {
  SearchIndexApplication,
  SearchIndexManifest,
  SearchIndexShard,
} from "../src/lib/search/index-format";
import { createMiniSearchIndex, type SearchIndexDocument } from "../src/lib/search/minisearch";

const directory = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = join(directory, "..");
const contentDirectory = join(projectRoot, "src", "content");
const outputDirectory = join(projectRoot, "static", "search-index");
const TARGET_SHARD_BYTES = 500 * 1024;

interface ApplicationSource {
  appId: "articles" | "shout";
  directory: "articles" | "events";
}

const applications: readonly ApplicationSource[] = [
  { appId: "articles", directory: "articles" },
  { appId: "shout", directory: "events" },
];

async function listMarkdownFiles(directoryPath: string): Promise<string[]> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directoryPath, entry.name);
      if (entry.isDirectory()) return listMarkdownFiles(path);
      return entry.name.endsWith(".md") ? [path] : [];
    }),
  );
  return files.flat();
}

function createExcerptLocal(markdown: string): string {
  return createExcerpt(markdown);
}

async function loadDocuments(source: ApplicationSource): Promise<SearchIndexDocument[]> {
  const applicationDirectory = join(contentDirectory, source.directory);
  const files = await listMarkdownFiles(applicationDirectory);
  const documents = await Promise.all(
    files.map(async (file) => {
      const raw = await readFile(file, "utf8");
      const { metadata, body } = parseMarkdown(raw);
      const articleId = parseArticleId(basename(file));
      const contentPath = relative(projectRoot, file).replaceAll("\\", "/");
      // 复用 content-pipeline 的统一投影（约束 4：构建期与运行时格式一致）
      const entry = {
        uid: contentPath,
        path: contentPath,
        collection: source.directory,
        filename: basename(file),
        id: articleId,
        title: metadata?.title ?? (articleId.slug || articleId.stem),
        date: metadata?.date ?? new Date(0),
        updated: metadata?.updated,
        tags: metadata?.tags ?? [],
        body,
        excerpt: createExcerptLocal(body),
        metadata: metadata ?? { date: new Date(0), tags: [] },
      };
      return entryToSearchDocument(entry);
    }),
  );
  return sortSearchDocuments(documents);
}

function serialize(documents: readonly SearchIndexDocument[]): string {
  const index = createMiniSearchIndex();
  index.addAll(documents);
  return JSON.stringify(index);
}

async function writeApplication(
  source: ApplicationSource,
  documents: readonly SearchIndexDocument[],
): Promise<SearchIndexApplication> {
  const shards: SearchIndexShard[] = [];
  let current: SearchIndexDocument[] = [];
  let shardNumber = 0;

  async function flush(): Promise<void> {
    if (current.length === 0) return;
    const serialized = serialize(current);
    const file = `${source.appId}-${String(shardNumber).padStart(4, "0")}.json`;
    await writeFile(join(outputDirectory, file), serialized, "utf8");
    shards.push({
      file,
      documentCount: current.length,
      newestDate: current[0].date,
      oldestDate: current.at(-1)!.date,
      bytes: Buffer.byteLength(serialized),
    });
    shardNumber += 1;
    current = [];
  }

  for (const document of documents) {
    const candidate = [...current, document];
    if (current.length > 0 && Buffer.byteLength(serialize(candidate)) > TARGET_SHARD_BYTES) {
      await flush();
    }
    current.push(document);
  }
  await flush();

  return { appId: source.appId, documentCount: documents.length, shards };
}

async function main(): Promise<void> {
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });

  const indexedApplications = await Promise.all(
    applications.map(async (source) => writeApplication(source, await loadDocuments(source))),
  );
  const manifest: SearchIndexManifest = {
    version: 1,
    applications: indexedApplications,
  };
  await writeFile(
    join(outputDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  console.log(
    `Built ${indexedApplications.length} application search indexes in static/search-index`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
