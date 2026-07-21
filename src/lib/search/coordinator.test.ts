/**
 * 正交意图：
 * 1. 原始需求（2026-07-21）：搜索要并发消费多个应用的异步结果流。
 * 2. 验证协调器不会把应用结果耦合到任何业务数据模型。
 */
import { describe, expect, it } from "vitest";
import { searchRegisteredServices } from "./coordinator";
import { parseLuceneQuery } from "./lucene";
import { searchServiceRegistry } from "./registry";
import type { SearchBatch, SearchService } from "./types";

function service(
  appId: string,
  appName: string,
  resultId: string,
): SearchService {
  return {
    appId,
    appName,
    async *search(): AsyncIterable<SearchBatch> {
      yield {
        appId,
        appName,
        results: [
          {
            id: resultId,
            appId,
            appName,
            title: resultId,
            excerpt: resultId,
            href: `/${resultId}`,
            date: 0,
            score: 1,
          },
        ],
        complete: true,
      };
    },
  };
}

function failingService(appId: string): SearchService {
  return {
    appId,
    appName: "失败应用",
    async *search(): AsyncIterable<SearchBatch> {
      throw new Error("索引不可用");
    },
  };
}

describe("searchRegisteredServices", () => {
  it("仅并发消费 Lucene app 筛选命中的服务", async () => {
    const articles = service("test-articles", "测试文章", "article-result");
    const shout = service("test-shout", "测试说说", "shout-result");
    searchServiceRegistry.register(articles);
    searchServiceRegistry.register(shout);

    try {
      const controller = new AbortController();
      const progress = [];
      for await (const event of searchRegisteredServices(
        parseLuceneQuery("app:test-articles signals"),
        controller.signal,
      )) {
        progress.push(event);
      }

      expect(progress.filter((event) => event.type === "batch")).toHaveLength(
        1,
      );
      expect(progress.at(0)).toMatchObject({
        type: "batch",
        batch: { appId: "test-articles" },
      });
      expect(progress.at(-1)).toEqual({ type: "complete" });
    } finally {
      searchServiceRegistry.unregister(articles.appId);
      searchServiceRegistry.unregister(shout.appId);
    }
  });

  it("单个应用失败时继续消费其它应用", async () => {
    const failed = failingService("test-failed");
    const healthy = service("test-healthy", "健康应用", "healthy-result");
    searchServiceRegistry.register(failed);
    searchServiceRegistry.register(healthy);

    try {
      const progress = [];
      for await (const event of searchRegisteredServices(
        parseLuceneQuery("signals"),
        new AbortController().signal,
      )) {
        progress.push(event);
      }

      expect(progress).toContainEqual({
        type: "service-error",
        appId: "test-failed",
        message: "索引不可用",
      });
      expect(progress).toContainEqual({
        type: "batch",
        batch: expect.objectContaining({ appId: "test-healthy" }),
      });
      expect(progress.at(-1)).toEqual({ type: "complete" });
    } finally {
      searchServiceRegistry.unregister(failed.appId);
      searchServiceRegistry.unregister(healthy.appId);
    }
  });
});
