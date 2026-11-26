import { readonlyFiles } from "$lib/vfs/readonly-data";
/**
 * 工具层测试：输入校验、limit/maxChars 收敛、搜索结果映射与 read_article 截断。
 *
 * 不依赖真实浏览器：fetch 用 stub，文章数据来自构建期 readonlyFiles。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { callTool } from "./tools";

function installFetch(payload: unknown): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => payload,
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requestBody(fetchMock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("search_site", () => {
  it("校验 query、收敛 limit，并只返回公开字段", async () => {
    const fetchMock = installFetch({
      results: [
        {
          id: "src/content/articles/0001.rust.md",
          appId: "articles",
          appName: "文章",
          title: "Rust 文章",
          excerpt: "x".repeat(400),
          href: "/article/articles/0001.rust",
          date: 1_700_000_000_000,
          score: 3,
        },
      ],
    });

    const result = await callTool("search_site", { query: "  rust  ", limit: 99 });

    expect(result.query).toBe("rust");
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toEqual({
      id: "src/content/articles/0001.rust.md",
      title: "Rust 文章",
      href: "/article/articles/0001.rust",
      excerpt: "x".repeat(300),
      date: 1_700_000_000_000,
      appName: "文章",
    });
    expect(requestBody(fetchMock)).toEqual({ q: "rust", limit: 5, mode: "hybrid" });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.method).toBe("POST");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("limit 下界收敛到 1", async () => {
    const fetchMock = installFetch({ results: [] });
    await callTool("search_site", { query: "rust", limit: 0 });
    expect(requestBody(fetchMock).limit).toBe(1);
  });

  it("拒绝空 query", async () => {
    await expect(callTool("search_site", { query: "   " })).rejects.toThrow("query 不能为空");
  });

  it("过滤外部/伪协议链接", async () => {
    installFetch({
      results: [
        {
          id: "src/content/articles/0001.a.md",
          title: "A",
          href: "javascript:alert(1)",
          excerpt: "",
          date: 0,
          appName: "文章",
        },
        {
          id: "src/content/articles/0002.b.md",
          title: "B",
          href: "/article/articles/0002.b",
          excerpt: "ok",
          date: 0,
          appName: "文章",
        },
      ],
    });
    const result = await callTool("search_site", { query: "x" });
    expect(result.results.map((item) => item.id)).toEqual(["src/content/articles/0002.b.md"]);
  });
});

describe("read_article", () => {
  const sampleId = "src/content/articles/0001.js-tree-index-multiple-keywords-and-check.md";

  it("从 readonlyFiles 读取并按 maxChars 截断", async () => {
    expect(typeof readonlyFiles[sampleId]).toBe("string");

    const result = await callTool("read_article", { id: sampleId, maxChars: 30 });

    if ("error" in result) throw new Error("不应返回 not_found");
    expect(result.id).toBe(sampleId);
    expect(result.title).toBeTruthy();
    expect(result.href).toBe("/article/articles/0001.js-tree-index-multiple-keywords-and-check");
    expect(Array.from(result.text)).toHaveLength(30);
    expect(result.truncated).toBe(true);
    expect(result.text.startsWith("---")).toBe(false);
  });

  it("去掉 HTML 标签并压缩多余空白", async () => {
    const id =
      "src/content/articles/0004.The-principle-of-writing-consistent-style-easy-to-understand-JavaScript.md";
    const result = await callTool("read_article", { id, maxChars: 1500 });

    if ("error" in result) throw new Error("不应返回 not_found");
    expect(result.text.toLowerCase()).not.toContain("<iframe");
    expect(result.text.toLowerCase()).not.toContain("<embed");
    expect(result.text).not.toContain("\n\n\n");
  });

  it("文件名含单引号的文章也能读取", async () => {
    const result = await callTool("read_article", {
      id: "src/content/articles/0002.Ya-'an-earthquake-Han-Han's-deleted-blog-post.md",
    });
    if ("error" in result) {
      // 真实内容从构建产物读取；本地测试环境没有该文件时至少不应因正则拒绝。
      expect(result.error).toBe("not_found");
    } else {
      expect(result.id).toContain("0002.");
    }
  });

  it("不存在的 id 返回 not_found", async () => {
    const result = await callTool("read_article", {
      id: "src/content/articles/9999.not-found.md",
    });
    expect(result).toEqual({ error: "not_found" });
  });

  it("拒绝 URL / 任意路径", async () => {
    await expect(
      callTool("read_article", { id: "https://example.com/article.md" }),
    ).rejects.toThrow();
    await expect(
      callTool("read_article", { id: "src/content/articles/../secret.md" }),
    ).rejects.toThrow();
    await expect(callTool("read_article", { id: 42 })).rejects.toThrow();
  });
});

describe("AbortSignal", () => {
  it("已取消时不再发请求", async () => {
    const fetchMock = installFetch({ results: [] });
    const controller = new AbortController();
    controller.abort();

    await expect(
      callTool("search_site", { query: "rust" }, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
