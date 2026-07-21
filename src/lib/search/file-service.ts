/**
 * 正交意图：
 * 1. 原始需求（2026-07-21）：文件类应用用 MiniSearch 搜索整个只读 VFS。
 * 2. 依时间顺序异步加载当前应用的静态索引分片并逐批返回结果。
 */
import { base } from "$app/paths";
import MiniSearch from "minisearch";
import { miniSearchOptions, type SearchIndexDocument } from "./minisearch";
import type {
  SearchIndexApplication,
  SearchIndexManifest,
} from "./index-format";
import type {
  SearchBatch,
  SearchResult,
  SearchService,
  SearchTask,
} from "./types";

interface FileSearchServiceOptions {
  appId: string;
  appName: string;
}

let manifestPromise: Promise<SearchIndexManifest> | null = null;
const indexPromises = new Map<
  string,
  Promise<MiniSearch<SearchIndexDocument>>
>();

function searchAssetUrl(file: string): string {
  return `${base}/search-index/${file}`;
}

async function loadManifest(): Promise<SearchIndexManifest> {
  if (!manifestPromise) {
    manifestPromise = fetch(searchAssetUrl("manifest.json")).then(
      async (response) => {
        if (!response.ok) throw new Error("搜索索引清单不可用");
        return (await response.json()) as SearchIndexManifest;
      },
    );
  }
  return manifestPromise;
}

function loadShard(file: string): Promise<MiniSearch<SearchIndexDocument>> {
  let indexPromise = indexPromises.get(file);
  if (!indexPromise) {
    indexPromise = fetch(searchAssetUrl(file))
      .then(async (response) => {
        if (!response.ok) throw new Error(`搜索索引分片不可用：${file}`);
        return response.text();
      })
      .then((serialized) =>
        MiniSearch.loadJSONAsync<SearchIndexDocument>(
          serialized,
          miniSearchOptions,
        ),
      );
    indexPromises.set(file, indexPromise);
  }
  return indexPromise;
}

function applicationIndex(
  manifest: SearchIndexManifest,
  appId: string,
): SearchIndexApplication | undefined {
  return manifest.applications.find(
    (application) => application.appId === appId,
  );
}

function toSearchResult(
  appId: string,
  appName: string,
  result: {
    id: string | number;
    score: number;
    title?: unknown;
    excerpt?: unknown;
    href?: unknown;
    date?: unknown;
  },
): SearchResult | null {
  if (
    typeof result.title !== "string" ||
    typeof result.excerpt !== "string" ||
    typeof result.href !== "string" ||
    typeof result.date !== "number"
  ) {
    return null;
  }
  return {
    id: `${appId}:${String(result.id)}`,
    appId,
    appName,
    title: result.title,
    excerpt: result.excerpt,
    href: result.href,
    date: result.date,
    score: result.score,
  };
}

/** 为拥有 VFS Markdown 的应用创建搜索服务闭包。 */
export function createFileSearchService(
  options: FileSearchServiceOptions,
): SearchService {
  return {
    appId: options.appId,
    appName: options.appName,
    async *search(task: SearchTask): AsyncIterable<SearchBatch> {
      const manifest = await loadManifest();
      const application = applicationIndex(manifest, options.appId);
      if (!application || task.signal.aborted) return;

      for (const [index, shard] of application.shards.entries()) {
        if (task.signal.aborted) return;
        const miniSearch = await loadShard(shard.file);
        if (task.signal.aborted) return;
        const hits = miniSearch.search(
          task.query.engineQuery ?? MiniSearch.wildcard,
          {
            prefix: true,
            fuzzy: 0.2,
          },
        );
        const results = hits
          .map((hit) => toSearchResult(options.appId, options.appName, hit))
          .filter((result): result is SearchResult => result !== null)
          .sort(
            (left, right) => right.date - left.date || right.score - left.score,
          );

        yield {
          appId: options.appId,
          appName: options.appName,
          results,
          complete: index === application.shards.length - 1,
        };
      }
    },
  };
}
