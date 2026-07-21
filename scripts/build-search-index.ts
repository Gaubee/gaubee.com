#!/usr/bin/env node
/**
 * 正交意图：
 * 1. 原始需求（2026-07-21）：按应用和时间拆分约 500 KiB 搜索索引文件。
 * 2. 从与 ReadonlyVFS 相同的 src/content Markdown 构建 MiniSearch 静态分片。
 */
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArticleId, parseMarkdown } from "../src/lib/data/frontmatter";
import {
  createMiniSearchIndex,
  type SearchIndexDocument,
} from "../src/lib/search/minisearch";
import type {
  SearchIndexApplication,
  SearchIndexManifest,
  SearchIndexShard,
} from "../src/lib/search/index-format";

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

function createExcerpt(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?(\[[^\]]*\])\([^)]*\)/g, "$1")
    .replace(/[#>*_`~]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

async function loadDocuments(
  source: ApplicationSource,
): Promise<SearchIndexDocument[]> {
  const applicationDirectory = join(contentDirectory, source.directory);
  const files = await listMarkdownFiles(applicationDirectory);
  const documents = await Promise.all(
    files.map(async (file) => {
      const raw = await readFile(file, "utf8");
      const { metadata, body } = parseMarkdown(raw);
      const articleId = parseArticleId(basename(file));
      const date = metadata?.date.getTime() ?? 0;
      const title = metadata?.title ?? (articleId.slug || articleId.stem);
      const contentPath = relative(projectRoot, file).replaceAll("\\", "/");
      return {
        id: contentPath,
        title,
        content: body,
        tags: metadata?.tags.join(" ") ?? "",
        excerpt: createExcerpt(body),
        href: `/article/${source.directory}/${articleId.stem}`,
        date,
      } satisfies SearchIndexDocument;
    }),
  );
  return documents.sort(
    (left, right) => right.date - left.date || left.id.localeCompare(right.id),
  );
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
    if (
      current.length > 0 &&
      Buffer.byteLength(serialize(candidate)) > TARGET_SHARD_BYTES
    ) {
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
    applications.map(async (source) =>
      writeApplication(source, await loadDocuments(source)),
    ),
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
