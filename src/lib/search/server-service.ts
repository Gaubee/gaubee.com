/**
 * 正交意图：
 * 1. 原始需求（2026-11）：文章/事件优先走 zvec 语义搜索服务，获得向量 + FTS 混合召回。
 * 2. 服务不可用、超时或响应异常时，无感回退到既有 MiniSearch 静态索引。
 */
import { createFileSearchService } from "./file-service";
import type { SearchBatch, SearchResult, SearchService, SearchTask } from "./types";

const DEFAULT_ENDPOINT = "/api/search";
/** 常规请求超时（服务已预热）。 */
const DEFAULT_TIMEOUT_MS = 800;
/** 冷启动首查超时（容器刚起、索引段尚未驻留）。 */
const COLD_TIMEOUT_MS = 2_000;
/** 每个应用一次请求取回的上限（服务端去重后）。 */
const REQUEST_LIMIT = 20;

export interface ServerSearchServiceOptions {
  appId: string;
  appName: string;
  /** 覆盖服务地址（测试/本地跨端口调试用）。 */
  endpoint?: string;
  fetchImpl?: typeof fetch;
  fallbackFactory?: () => SearchService;
  timeoutMs?: number;
  coldTimeoutMs?: number;
}

interface ServerSearchItem {
  id: string;
  appId: string;
  appName: string;
  title: string;
  excerpt: string;
  href: string;
  date: number;
  score: number;
}

interface ServerSearchResponse {
  results: ServerSearchItem[];
  total: number;
  tookMs: number;
  engine: string;
  degraded: boolean;
}

function resolveEndpoint(): string {
  const configured = (import.meta.env as Record<string, string | undefined>).VITE_SEARCH_SERVER_URL;
  const trimmed = configured?.trim();
  return trimmed ? trimmed : DEFAULT_ENDPOINT;
}

function toSearchResult(appId: string, item: ServerSearchItem): SearchResult | null {
  if (
    typeof item.id !== "string" ||
    typeof item.title !== "string" ||
    typeof item.excerpt !== "string" ||
    typeof item.href !== "string" ||
    typeof item.date !== "number" ||
    typeof item.score !== "number"
  ) {
    return null;
  }
  return {
    id: `${appId}:${item.id}`,
    appId,
    appName: item.appName || appId,
    title: item.title,
    excerpt: item.excerpt,
    href: item.href,
    date: item.date,
    score: item.score,
  };
}

/**
 * 创建走 `/api/search` 的搜索服务；任何失败都会回退文件搜索服务。
 *
 * 每个应用注册一个实例（协调器按 appId 过滤），请求携带 `apps:[appId]`，
 * 因此服务端只返回本应用结果；MiniSearch 回退语义与既有实现一致。
 */
export function createServerSearchService(options: ServerSearchServiceOptions): SearchService {
  const endpoint = options.endpoint ?? resolveEndpoint();
  const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const fallbackFactory =
    options.fallbackFactory ??
    (() => createFileSearchService({ appId: options.appId, appName: options.appName }));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const coldTimeoutMs = options.coldTimeoutMs ?? COLD_TIMEOUT_MS;

  let cold = true;

  return {
    appId: options.appId,
    appName: options.appName,
    async *search(task: SearchTask): AsyncIterable<SearchBatch> {
      const text = task.query.text.trim();
      if (task.signal.aborted) return;
      if (!text) {
        yield* fallbackFactory().search(task);
        return;
      }

      const controller = new AbortController();
      const abort = () => controller.abort();
      task.signal.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(() => controller.abort(), cold ? coldTimeoutMs : timeoutMs);

      try {
        const filters = task.query.filters;
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            q: text,
            apps: [options.appId],
            tags: filters?.tags,
            dateFrom: filters?.dateFrom,
            dateTo: filters?.dateTo,
            limit: REQUEST_LIMIT,
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`搜索服务返回 ${response.status}`);
        }
        const payload = (await response.json()) as ServerSearchResponse;
        if (!payload || !Array.isArray(payload.results)) {
          throw new Error("搜索服务响应格式错误");
        }
        cold = false;
        if (task.signal.aborted) return;

        const results = payload.results
          .map((item) => toSearchResult(options.appId, item))
          .filter((result): result is SearchResult => result !== null);
        yield {
          appId: options.appId,
          appName: options.appName,
          results,
          complete: true,
        };
      } catch {
        cold = false;
        if (task.signal.aborted) return;
        // 服务失败/超时：回退静态 MiniSearch 索引，搜索不中断。
        yield* fallbackFactory().search(task);
      } finally {
        clearTimeout(timer);
        task.signal.removeEventListener("abort", abort);
      }
    },
  };
}
