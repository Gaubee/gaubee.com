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
  fetchGithub: (path: string, init?: RequestInit) =>
    mockFetchGithub(path, init),
}));

// mock $app/environment（os/services 间接依赖）
vi.mock("$app/environment", () => ({ browser: true }));

const { getFileText, commitChanges } = await import("./client");
const { NotAuthenticatedError } = await import("$lib/os/services");

/** 构造 fake Response。 */
function makeResp(ok: boolean, status: number, body: unknown = {}): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe("client assertOk — 401/403 映射", () => {
  it("getFileText 401 → NotAuthenticatedError", async () => {
    mockFetchGithub.mockResolvedValueOnce(makeResp(false, 401));
    await expect(getFileText("src/content/articles/x.md")).rejects.toThrow(
      NotAuthenticatedError,
    );
  });

  it("getFileText 403 → NotAuthenticatedError", async () => {
    mockFetchGithub.mockResolvedValueOnce(makeResp(false, 403));
    await expect(getFileText("src/content/articles/x.md")).rejects.toThrow(
      NotAuthenticatedError,
    );
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
    await expect(
      commitChanges("msg", [{ path: "a.md", content: "x" }]),
    ).rejects.toThrow(NotAuthenticatedError);
  });

  it("更新 ref 阶段 401 → NotAuthenticatedError（前几步成功）", async () => {
    // 模拟前 4 步成功，第 5 步（updateRef）401
    mockFetchGithub
      .mockResolvedValueOnce(makeResp(true, 200, { object: { sha: "refsha" } }))
      .mockResolvedValueOnce(makeResp(true, 200, { tree: { sha: "treesha" } }))
      .mockResolvedValueOnce(makeResp(true, 200, { sha: "newtreesha" }))
      .mockResolvedValueOnce(makeResp(true, 200, { sha: "newcommitsha" }))
      .mockResolvedValueOnce(makeResp(false, 401)); // updateRef 401
    await expect(
      commitChanges("msg", [{ path: "a.md", content: "x" }]),
    ).rejects.toThrow(NotAuthenticatedError);
  });
});
