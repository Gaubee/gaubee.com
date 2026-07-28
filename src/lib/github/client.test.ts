/**
 * GitHub client 单元测试。
 *
 * 重点验证：401/403 → NotAuthenticatedError 映射（会话过期场景），
 * 以及 assertOk 的分支逻辑。
 */
import { describe, expect, it, vi } from "vitest";

// mock fetchGithub（client.ts 的唯一外部网络依赖）
const mockFetchGithub = vi.fn();
vi.mock("$lib/auth/session.svelte", () => ({
  fetchGithub: (path: string, init?: RequestInit) => mockFetchGithub(path, init),
}));

// mock $app/environment（os/services 间接依赖）
vi.mock("$app/environment", () => ({ browser: true }));

const { getFileText, commitChanges, getFileWithSha, updateFileContent } = await import("./client");
const { NotAuthenticatedError } = await import("$lib/os/services");

/** 构造 fake Response。body 同时供 json() 和 text()（assertOk 读 text 判断 rate limit）。 */
function makeResp(ok: boolean, status: number, body: unknown = {}): Response {
  const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok,
    status,
    json: async () => (typeof body === "string" ? JSON.parse(body) : body),
    text: async () => bodyStr,
  } as Response;
}

describe("client assertOk — 401/403 映射", () => {
  it("getFileText 401 → NotAuthenticatedError", async () => {
    mockFetchGithub.mockResolvedValueOnce(makeResp(false, 401));
    await expect(getFileText("src/content/articles/x.md")).rejects.toThrow(NotAuthenticatedError);
  });

  it("getFileText 403 rate limit → 普通 Error（非鉴权，不引导登录）", async () => {
    mockFetchGithub.mockResolvedValueOnce(
      makeResp(false, 403, "API rate limit exceeded for anonymous"),
    );
    await expect(getFileText("src/content/articles/x.md")).rejects.not.toThrow(
      NotAuthenticatedError,
    );
  });

  it("getFileText 403 权限不足 → NotAuthenticatedError", async () => {
    mockFetchGithub.mockResolvedValueOnce(makeResp(false, 403, "forbidden"));
    await expect(getFileText("src/content/articles/x.md")).rejects.toThrow(NotAuthenticatedError);
  });

  it("getFileText 500 → 普通 Error（非 NotAuthenticatedError）", async () => {
    mockFetchGithub.mockResolvedValueOnce(makeResp(false, 500));
    await expect(getFileText("src/content/articles/x.md")).rejects.not.toThrow(
      NotAuthenticatedError,
    );
  });

  it("getFileText 200 → 正常返回内容", async () => {
    mockFetchGithub.mockResolvedValueOnce(
      makeResp(true, 200, {
        type: "file",
        encoding: "base64",
        content: btoa("# hello"),
        name: "x.md",
        path: "src/content/articles/x.md",
        sha: "abc",
        size: 7,
      }),
    );
    const text = await getFileText("src/content/articles/x.md");
    expect(text).toBe("# hello");
  });
});

describe("commitChanges — 401 映射", () => {
  it("获取 ref 阶段 401 → NotAuthenticatedError", async () => {
    // commitChanges 第一步获取 ref，401 即抛
    mockFetchGithub.mockResolvedValueOnce(makeResp(false, 401));
    await expect(commitChanges("msg", [{ path: "a.md", content: "x" }])).rejects.toThrow(
      NotAuthenticatedError,
    );
  });

  it("更新 ref 阶段 401 → NotAuthenticatedError（前几步成功）", async () => {
    // 模拟前 4 步成功，第 5 步（updateRef）401
    mockFetchGithub
      .mockResolvedValueOnce(makeResp(true, 200, { object: { sha: "refsha" } }))
      .mockResolvedValueOnce(makeResp(true, 200, { tree: { sha: "treesha" } }))
      .mockResolvedValueOnce(makeResp(true, 200, { sha: "newtreesha" }))
      .mockResolvedValueOnce(makeResp(true, 200, { sha: "newcommitsha" }))
      .mockResolvedValueOnce(makeResp(false, 401)); // updateRef 401
    await expect(commitChanges("msg", [{ path: "a.md", content: "x" }])).rejects.toThrow(
      NotAuthenticatedError,
    );
  });
});

describe("getFileWithSha — 拿 sha 用于乐观锁", () => {
  it("200 → 返回 {content, sha}", async () => {
    mockFetchGithub.mockResolvedValueOnce(
      makeResp(true, 200, {
        type: "file",
        encoding: "base64",
        content: btoa("body content"),
        name: "x.md",
        path: "x.md",
        sha: "abc123",
        size: 12,
      }),
    );
    const result = await getFileWithSha("x.md", { owner: "o", repo: "r" });
    expect(result.content).toBe("body content");
    expect(result.sha).toBe("abc123");
    // 验证 URL 含 owner/repo + ref 查询参数
    const [path] = mockFetchGithub.mock.calls.at(-1)!;
    expect(path).toBe("repos/o/r/contents/x.md?ref=main");
  });

  it("404 → 抛错（文件不存在）", async () => {
    mockFetchGithub.mockResolvedValueOnce(makeResp(false, 404));
    await expect(getFileWithSha("nope.md")).rejects.toThrow();
  });
});

describe("updateFileContent — PUT Contents API", () => {
  it("构造 PUT 请求 + base64 编码 + sha 乐观锁", async () => {
    mockFetchGithub.mockResolvedValueOnce(makeResp(true, 200, { commit: { sha: "newcommitsha" } }));
    const sha = await updateFileContent("path/to/file.md", "new content", {
      owner: "gaubee",
      repo: "test",
      branch: "main",
      sha: "oldsha",
      message: "update file",
    });
    expect(sha).toBe("newcommitsha");

    const [path, init] = mockFetchGithub.mock.calls.at(-1)!;
    expect(path).toBe("repos/gaubee/test/contents/path/to/file.md");
    expect(init?.method).toBe("PUT");
    const body = JSON.parse(init?.body as string);
    expect(body.message).toBe("update file");
    expect(body.sha).toBe("oldsha");
    expect(body.branch).toBe("main");
    // base64 解码回 "new content"
    const decoded = atob(body.content);
    expect(decoded).toBe("new content");
  });

  it("新建文件不传 sha（body 不含 sha 字段）", async () => {
    mockFetchGithub.mockResolvedValueOnce(makeResp(true, 201, { commit: { sha: "newsha" } }));
    await updateFileContent("new.md", "hi", {
      owner: "o",
      repo: "r",
      message: "create",
    });
    const [, init] = mockFetchGithub.mock.calls.at(-1)!;
    const body = JSON.parse(init?.body as string);
    expect(body.sha).toBeUndefined();
    expect(body.branch).toBeUndefined();
  });

  it("401 → NotAuthenticatedError", async () => {
    mockFetchGithub.mockResolvedValueOnce(makeResp(false, 401));
    await expect(
      updateFileContent("x.md", "y", { owner: "o", repo: "r", message: "m" }),
    ).rejects.toThrow(NotAuthenticatedError);
  });
});
