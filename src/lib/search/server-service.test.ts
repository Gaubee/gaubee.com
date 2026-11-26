/**
 * 正交意图：
 * 1. 原始需求（2026-11）：验证语义搜索服务的请求契约与失败回退。
 * 2. 不依赖真实 HTTP/静态索引：注入 fetch 与 fallback 闭包。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createMiniSearchIndex } from "./minisearch";
import { COLD_TIMEOUT_MS, createServerSearchService, DEFAULT_TIMEOUT_MS } from "./server-service";
import type { SearchBatch, SearchQuery, SearchResult, SearchService } from "./types";

afterEach(() => {
  vi.unstubAllGlobals();
});

function query(text: string, filters?: SearchQuery["filters"]): SearchQuery {
  return {
    source: text,
    text,
    includeAppIds: [],
    excludeAppIds: [],
    engineQuery: null,
    filters,
  };
}

const fallbackResult: SearchResult = {
  id: "event:src/content/events/fallback.md",
  appId: "event",
  appName: "事件",
  title: "回退结果",
  excerpt: "来自 MiniSearch",
  href: "/article/events/fallback",
  date: 1,
  score: 1,
};

function fallbackService(calls: { count: number }): SearchService {
  return {
    appId: "event",
    appName: "事件",
    async *search(): AsyncIterable<SearchBatch> {
      calls.count += 1;
      yield {
        appId: "event",
        appName: "事件",
        results: [fallbackResult],
        complete: true,
      };
    },
  };
}

async function collect(
  service: SearchService,
  searchQuery: SearchQuery,
  signal = new AbortController().signal,
): Promise<SearchBatch[]> {
  const batches: SearchBatch[] = [];
  for await (const batch of service.search({ query: searchQuery, signal })) {
    batches.push(batch);
  }
  return batches;
}

describe("createServerSearchService", () => {
  it("默认超时覆盖 mistral-embed 延迟并保留冷启动余量", () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(1_200);
    expect(COLD_TIMEOUT_MS).toBe(2_500);
  });

  it("把自由文本与应用过滤发给 /api/search，并映射结果", async () => {
    const calls: { url?: string; init?: RequestInit } = {};
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.url = String(input);
      calls.init = init;
      return new Response(
        JSON.stringify({
          results: [
            {
              id: "src/content/events/a.md",
              appId: "event",
              appName: "事件",
              title: "标题",
              excerpt: "摘要",
              href: "/article/events/a",
              date: 123,
              score: 0.9,
            },
          ],
          total: 1,
          tookMs: 3,
          engine: "zvec",
          degraded: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    const fallbackCalls = { count: 0 };
    const service = createServerSearchService({
      appId: "event",
      appName: "事件",
      endpoint: "http://127.0.0.1:17081/api/search",
      fetchImpl,
      fallbackFactory: () => fallbackService(fallbackCalls),
    });

    const batches = await collect(service, query("Claude Code 记忆"));

    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({ appId: "event", complete: true });
    expect(batches[0].results[0]).toMatchObject({
      id: "event:src/content/events/a.md",
      title: "标题",
      href: "/article/events/a",
      score: 0.9,
    });
    expect(calls.url).toBe("http://127.0.0.1:17081/api/search");
    const body = JSON.parse(String(calls.init?.body));
    expect(body).toMatchObject({ q: "Claude Code 记忆", apps: ["event"], limit: 20 });
    expect(fallbackCalls.count).toBe(0);
  });

  it("透传 tags/date 过滤", async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as typeof fetch;
    const service = createServerSearchService({
      appId: "articles",
      appName: "文章",
      endpoint: "/api/search",
      fetchImpl,
      fallbackFactory: () => fallbackService({ count: 0 }),
    });

    await collect(service, query("rust", { tags: ["rust"], dateFrom: 100, dateTo: 200 }));

    expect(body.tags).toEqual(["rust"]);
    expect(body.dateFrom).toBe(100);
    expect(body.dateTo).toBe(200);
  });

  it("服务 500 时回退 MiniSearch", async () => {
    const fallbackCalls = { count: 0 };
    const fetchImpl = (async () => new Response("boom", { status: 500 })) as typeof fetch;
    const service = createServerSearchService({
      appId: "event",
      appName: "事件",
      endpoint: "/api/search",
      fetchImpl,
      fallbackFactory: () => fallbackService(fallbackCalls),
    });

    const batches = await collect(service, query("signals"));

    expect(fallbackCalls.count).toBe(1);
    expect(batches).toHaveLength(1);
    expect(batches[0].results[0].id).toBe(fallbackResult.id);
  });

  it("超时自动回退", async () => {
    const fallbackCalls = { count: 0 };
    const hangingFetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      })) as typeof fetch;
    const service = createServerSearchService({
      appId: "event",
      appName: "事件",
      endpoint: "/api/search",
      fetchImpl: hangingFetch,
      fallbackFactory: () => fallbackService(fallbackCalls),
      timeoutMs: 10,
      coldTimeoutMs: 10,
    });

    const batches = await collect(service, query("signals"));

    expect(fallbackCalls.count).toBe(1);
    expect(batches[0].results[0].id).toBe(fallbackResult.id);
  });

  it("纯 app 过滤（无自由文本）直接走 MiniSearch", async () => {
    const fallbackCalls = { count: 0 };
    const service = createServerSearchService({
      appId: "event",
      appName: "事件",
      endpoint: "/api/search",
      fetchImpl: (async () => {
        throw new Error("不应发起请求");
      }) as typeof fetch,
      fallbackFactory: () => fallbackService(fallbackCalls),
    });

    const batches = await collect(service, query(""));

    expect(fallbackCalls.count).toBe(1);
    expect(batches).toHaveLength(1);
  });

  it("调用方取消后不发起回退", async () => {
    const controller = new AbortController();
    controller.abort();
    const fallbackCalls = { count: 0 };
    const service = createServerSearchService({
      appId: "event",
      appName: "事件",
      endpoint: "/api/search",
      fetchImpl: (async () => {
        throw new Error("不应发起请求");
      }) as typeof fetch,
      fallbackFactory: () => fallbackService(fallbackCalls),
    });

    const batches = await collect(service, query("signals"), controller.signal);

    expect(batches).toHaveLength(0);
    expect(fallbackCalls.count).toBe(0);
  });
});

describe("server-service → 真实 MiniSearch 回退", () => {
  it("服务 500 时由 createFileSearchService 接管", async () => {
    const index = createMiniSearchIndex();
    index.add({
      id: "src/content/events/a.md",
      title: "Signals proposal",
      content: "signals observable proposal",
      tags: "javascript",
      excerpt: "signals",
      href: "/article/events/a",
      date: 123,
    });
    const serialized = JSON.stringify(index);
    const manifest = {
      version: 1,
      applications: [
        {
          appId: "event",
          documentCount: 1,
          shards: [
            {
              file: "event-0.json",
              documentCount: 1,
              newestDate: 123,
              oldestDate: 123,
              bytes: serialized.length,
            },
          ],
        },
      ],
    };

    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/search")) {
        return new Response("boom", { status: 500 });
      }
      if (url.endsWith("/search-index/manifest.json")) {
        return new Response(JSON.stringify(manifest), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/search-index/event-0.json")) {
        return new Response(serialized, { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const service = createServerSearchService({
      appId: "event",
      appName: "事件",
      endpoint: "/api/search",
    });
    const batches = await collect(service, query("signals"));

    expect(batches).toHaveLength(1);
    expect(batches[0].results).toHaveLength(1);
    expect(batches[0].results[0]).toMatchObject({
      id: "event:src/content/events/a.md",
      title: "Signals proposal",
      href: "/article/events/a",
    });
  });
});
