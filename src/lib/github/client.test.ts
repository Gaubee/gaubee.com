/**
 * GitHub client 单元测试。
 *
 * 重点验证：401/403 → NotAuthenticatedError 映射（会话过期场景），
 * 以及 assertOk 的分支逻辑。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// mock fetchGithub（client.ts 的唯一外部网络依赖）
const mockFetchGithub = vi.fn();
vi.mock("$lib/auth/session.svelte", () => ({
  fetchGithub: (path: string, init?: RequestInit) => mockFetchGithub(path, init),
}));

// mock $app/environment（os/services 间接依赖）
vi.mock("$app/environment", () => ({ browser: true }));

const { getFileText, commitChanges, getFileWithSha, updateFileContent, createBlob } =
  await import("./client");
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

// 每个 case 前清理 mock 历史，避免跨测试残留（mock.calls 累积导致断言污染）
beforeEach(() => {
  mockFetchGithub.mockClear();
});

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

describe("createBlob — Git Data API 二进制上传", () => {
  it("POST /git/blobs，body 含 content + encoding，返回 sha", async () => {
    mockFetchGithub.mockResolvedValueOnce(makeResp(true, 201, { sha: "blob123" }));
    const sha = await createBlob("aGVsbG8=", "base64", { owner: "o", repo: "r" });
    expect(sha).toBe("blob123");
    const [path, init] = mockFetchGithub.mock.calls.at(-1)!;
    expect(path).toBe("repos/o/r/git/blobs");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string);
    expect(body.content).toBe("aGVsbG8=");
    expect(body.encoding).toBe("base64");
  });

  it("401 → NotAuthenticatedError", async () => {
    mockFetchGithub.mockResolvedValueOnce(makeResp(false, 401));
    await expect(createBlob("x", "utf-8", { owner: "o", repo: "r" })).rejects.toThrow(
      NotAuthenticatedError,
    );
  });
});

describe("commitChanges — 二进制 + 文本混合提交", () => {
  it("base64 条目先 createBlob 拿 sha，tree item 带 sha 不带 content", async () => {
    // 1. ref → 2. commit(base tree) → 3. createBlob(二进制) → 4. trees → 5. commit → 6. updateRef
    mockFetchGithub
      .mockResolvedValueOnce(makeResp(true, 200, { object: { sha: "refsha" } })) // GET ref
      .mockResolvedValueOnce(makeResp(true, 200, { tree: { sha: "treesha" } })) // GET commit
      .mockResolvedValueOnce(makeResp(true, 201, { sha: "blobsha" })) // POST blob（二进制）
      .mockResolvedValueOnce(makeResp(true, 201, { sha: "newtreesha" })) // POST trees
      .mockResolvedValueOnce(makeResp(true, 201, { sha: "newcommitsha" })) // POST commit
      .mockResolvedValueOnce(makeResp(true, 200, {})); // PATCH ref

    const sha = await commitChanges(
      "add image",
      [
        { path: "text.md", content: "hello" },
        { path: "img.png", content: "aW1hZ2U=", encoding: "base64" },
      ],
      { owner: "o", repo: "r", branch: "main" },
    );
    expect(sha).toBe("newcommitsha");

    // 找到 POST /git/trees 的调用，验证 tree items
    const treesCall = mockFetchGithub.mock.calls.find(
      ([p, init]) => p === "repos/o/r/git/trees" && init?.method === "POST",
    );
    expect(treesCall).toBeDefined();
    const treeBody = JSON.parse(treesCall![1]!.body as string);
    expect(treeBody.base_tree).toBe("treesha");
    // 文本条目：带 content
    const textItem = treeBody.tree.find((t: { path: string }) => t.path === "text.md");
    expect(textItem.content).toBe("hello");
    expect(textItem.sha).toBeUndefined();
    // 二进制条目：带 sha 不带 content
    const imgItem = treeBody.tree.find((t: { path: string }) => t.path === "img.png");
    expect(imgItem.sha).toBe("blobsha");
    expect(imgItem.content).toBeUndefined();
  });

  it("纯文本提交不调用 createBlob", async () => {
    mockFetchGithub
      .mockResolvedValueOnce(makeResp(true, 200, { object: { sha: "refsha" } }))
      .mockResolvedValueOnce(makeResp(true, 200, { tree: { sha: "treesha" } }))
      .mockResolvedValueOnce(makeResp(true, 201, { sha: "newtreesha" }))
      .mockResolvedValueOnce(makeResp(true, 201, { sha: "newcommitsha" }))
      .mockResolvedValueOnce(makeResp(true, 200, {}));

    await commitChanges("txt only", [{ path: "a.md", content: "x" }], {
      owner: "o",
      repo: "r",
    });
    // 不应有 /git/blobs 调用
    const blobCall = mockFetchGithub.mock.calls.find(([p]) => p === "repos/o/r/git/blobs");
    expect(blobCall).toBeUndefined();
  });
});
