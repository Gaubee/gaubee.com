/**
 * VFS 核心单元测试。
 *
 * 用 fake-indexeddb 提供内存 IndexedDB，mock 掉 GitHub client。
 * 覆盖：读写删除、dirty 追踪、三层读取、readdir、commit。
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// fake-indexeddb/auto 自动注册所有 IndexedDB 全局符号到 globalThis
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

// mock GitHub client（VFS 依赖 fetchGithub → fetch，这里全替换）
const mockGetFileText = vi.fn<(p: string) => Promise<string>>();
const mockFetchTree = vi.fn<
  () => Promise<{
    tree: Array<{
      path: string;
      mode: string;
      type: "blob";
      sha: string;
      size?: number;
    }>;
    sha: string;
    truncated: boolean;
  }>
>();
const mockCommitChanges = vi.fn();

vi.mock("$lib/github/client", () => ({
  OWNER: "gaubee",
  REPO: "gaubee.com",
  BRANCH: "main",
  getFileText: (p: string) => mockGetFileText(p),
  fetchTree: () => mockFetchTree(),
  commitChanges: mockCommitChanges,
}));

vi.mock("$app/environment", () => ({ browser: true }));

// 动态 import（确保 mock 生效）
const { vfs } = await import("./vfs");
const { vfsClear } = await import("$lib/db");

function freshIndexedDB() {
  // 每个测试用全新 IndexedDB 实例（auto 已注册全局符号）
  globalThis.indexedDB = new IDBFactory();
}

beforeAll(() => {
  freshIndexedDB();
});

beforeEach(async () => {
  // 每个测试用全新 IndexedDB 实例
  freshIndexedDB();
  await vfsClear();
  mockGetFileText.mockReset();
  mockFetchTree.mockReset();
  mockCommitChanges.mockReset();
});

describe("VFS 读写", () => {
  it("writeFile 写入后 readFile 读回", async () => {
    await vfs.writeFile("src/content/articles/0001.test.md", "# 标题\n正文");
    const content = await vfs.readFile("src/content/articles/0001.test.md");
    expect(content).toBe("# 标题\n正文");
  });

  it("writeFile 标记 dirty=true，新建 origin=local", async () => {
    await vfs.writeFile("new/file.md", "x");
    const stat = await vfs.stat("new/file.md");
    expect(stat?.dirty).toBe(true);
    expect(stat?.origin).toBe("local");
    expect(stat?.sha).toBeNull();
  });

  it("readFile 无缓存时在线拉取并写入 VFS", async () => {
    mockGetFileText.mockResolvedValueOnce("# 远程内容");
    const content = await vfs.readFile("remote/article.md");
    expect(content).toBe("# 远程内容");
    expect(mockGetFileText).toHaveBeenCalledWith("remote/article.md");
    // 第二次读应命中缓存，不再调 getFileText
    mockGetFileText.mockClear();
    await vfs.readFile("remote/article.md");
    expect(mockGetFileText).not.toHaveBeenCalled();
  });
});

describe("VFS 删除与撤销", () => {
  it("unlink 标记删除，readFile 抛 ENOENT", async () => {
    await vfs.writeFile("a/b.md", "内容");
    await vfs.unlink("a/b.md");
    await expect(vfs.readFile("a/b.md")).rejects.toThrow(/ENOENT/);
  });

  it("unlink 后 stat 仍存在（保留 sha 供 commit）", async () => {
    await vfs.writeFile("a/b.md", "内容");
    await vfs.unlink("a/b.md");
    const stat = await vfs.stat("a/b.md");
    expect(stat).not.toBeNull();
    expect(stat?.dirty).toBe(true);
  });

  it("revert 本地新建文件 = 删除记录", async () => {
    await vfs.writeFile("local.md", "x");
    await vfs.revert("local.md");
    const stat = await vfs.stat("local.md");
    expect(stat).toBeNull();
  });

  it("revert remote 文件 = 重新拉取清 dirty", async () => {
    // 先模拟 remote 缓存
    mockGetFileText.mockResolvedValue("# 原始");
    await vfs.readFile("remote/x.md");
    // 本地修改
    await vfs.writeFile("remote/x.md", "# 修改");
    expect((await vfs.stat("remote/x.md"))?.dirty).toBe(true);
    // 撤销：重新拉
    mockGetFileText.mockResolvedValueOnce("# 原始");
    await vfs.revert("remote/x.md");
    const stat = await vfs.stat("remote/x.md");
    expect(stat?.dirty).toBe(false);
    expect(stat?.content).toBe("# 原始");
  });
});

describe("VFS readdir", () => {
  beforeEach(async () => {
    await vfs.writeFile("src/content/articles/0001.a.md", "a");
    await vfs.writeFile("src/content/articles/0002.b.md", "b");
    await vfs.writeFile("src/content/events/00001.c.md", "c");
    await vfs.writeFile("README.md", "readme");
  });

  it("递归列出全部", async () => {
    const all = await vfs.readdir("", { recursive: true });
    expect(all).toHaveLength(4);
    expect(all.map((n) => n.path).sort()).toEqual([
      "README.md",
      "src/content/articles/0001.a.md",
      "src/content/articles/0002.b.md",
      "src/content/events/00001.c.md",
    ]);
  });

  it("按前缀筛选", async () => {
    const articles = await vfs.readdir("src/content/articles", {
      recursive: true,
    });
    expect(articles).toHaveLength(2);
  });

  it("非递归只列直接子项", async () => {
    const top = await vfs.readdir("", { recursive: false });
    // 直接子项：README.md, src/（目录不返回，只返回文件）
    expect(top.map((n) => n.path)).toContain("README.md");
    expect(top.find((n) => n.path.startsWith("src/"))).toBeUndefined();
  });

  it("过滤掉删除的文件", async () => {
    await vfs.unlink("src/content/articles/0001.a.md");
    const all = await vfs.readdir("");
    expect(
      all.find((n) => n.path === "src/content/articles/0001.a.md"),
    ).toBeUndefined();
  });
});

describe("VFS dirtyFiles", () => {
  it("列出所有 dirty 文件（含删除）", async () => {
    await vfs.writeFile("a.md", "x");
    await vfs.writeFile("b.md", "y");
    // 模拟一个 remote clean 文件
    mockGetFileText.mockResolvedValue("clean");
    await vfs.readFile("c.md");
    await vfs.unlink("c.md");

    const dirty = await vfs.dirtyFiles();
    expect(dirty).toHaveLength(3);
    expect(dirty.map((n) => n.path).sort()).toEqual(["a.md", "b.md", "c.md"]);
  });
});

describe("VFS fetch（增量同步）", () => {
  it("远程有 VFS 无 → 拉取", async () => {
    mockFetchTree.mockResolvedValue({
      tree: [
        {
          path: "src/content/articles/0001.a.md",
          mode: "100644",
          type: "blob",
          sha: "sha1",
        },
      ],
      sha: "root",
      truncated: false,
    });
    mockGetFileText.mockResolvedValue("# 内容");
    await vfs.fetch("src/content");
    const stat = await vfs.stat("src/content/articles/0001.a.md");
    expect(stat?.sha).toBe("sha1");
    expect(stat?.origin).toBe("remote");
    expect(stat?.dirty).toBe(false);
    expect(stat?.content).toBe("# 内容");
  });

  it("sha 未变 → 跳过拉取", async () => {
    // 第一次 fetch
    mockFetchTree.mockResolvedValue({
      tree: [{ path: "a.md", mode: "100644", type: "blob", sha: "sha1" }],
      sha: "root",
      truncated: false,
    });
    mockGetFileText.mockResolvedValueOnce("# v1");
    await vfs.fetch();
    expect(mockGetFileText).toHaveBeenCalledTimes(1);

    // 第二次 fetch，sha 不变
    mockGetFileText.mockClear();
    await vfs.fetch();
    expect(mockGetFileText).not.toHaveBeenCalled();
  });

  it("不覆盖本地 dirty 修改", async () => {
    // 先有本地修改
    await vfs.writeFile("a.md", "# 本地修改");
    // fetch 报告远程版本
    mockFetchTree.mockResolvedValue({
      tree: [{ path: "a.md", mode: "100644", type: "blob", sha: "remote-sha" }],
      sha: "root",
      truncated: false,
    });
    mockGetFileText.mockResolvedValue("# 远程");
    await vfs.fetch();
    // 本地修改应保留
    const content = await vfs.readFile("a.md");
    expect(content).toBe("# 本地修改");
    const stat = await vfs.stat("a.md");
    expect(stat?.dirty).toBe(true);
  });
});

describe("VFS commit", () => {
  it("把 dirty 文件批量提交，成功后清 dirty", async () => {
    await vfs.writeFile("a.md", "内容A");
    await vfs.writeFile("b.md", "内容B");
    mockCommitChanges.mockResolvedValue("new-commit-sha");

    const sha = await vfs.commit("test commit");
    expect(sha).toBe("new-commit-sha");
    expect(mockCommitChanges).toHaveBeenCalledOnce();
    const arg = mockCommitChanges.mock.calls[0];
    expect(arg[0]).toBe("test commit");
    expect(arg[1]).toHaveLength(2);

    // dirty 清除
    const dirty = await vfs.dirtyFiles();
    expect(dirty).toHaveLength(0);
  });

  it("删除的文件 commit 后从 VFS 移除", async () => {
    await vfs.writeFile("to-delete.md", "x");
    await vfs.unlink("to-delete.md");
    mockCommitChanges.mockResolvedValue("sha");

    await vfs.commit("delete");
    const stat = await vfs.stat("to-delete.md");
    expect(stat).toBeNull();
  });

  it("无 dirty 时抛错", async () => {
    await expect(vfs.commit("empty")).rejects.toThrow(/没有待提交/);
  });

  it("commit 的 StagedChange 正确区分删除与修改", async () => {
    await vfs.writeFile("modify.md", "新内容");
    await vfs.writeFile("delete.md", "x");
    await vfs.unlink("delete.md");
    mockCommitChanges.mockResolvedValue("sha");

    await vfs.commit("mixed");
    const changes = mockCommitChanges.mock.calls[0][1] as Array<{
      path: string;
      content: string | null;
      sha: string | null;
    }>;
    const modifyChange = changes.find((c) => c.path === "modify.md");
    const deleteChange = changes.find((c) => c.path === "delete.md");
    expect(modifyChange?.content).toBe("新内容");
    expect(deleteChange?.content).toBeNull();
  });
});
