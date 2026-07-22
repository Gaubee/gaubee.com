/**
 * VfsStore 适配层测试（浏览器环境，支持 Svelte 5 runes）。
 *
 * 重点验证 commit 的 commitInFlight 互斥与 sync 的 inFlight 合并。
 * mock 掉底层 vfs 的 IndexedDB 依赖，专注测 store 层的并发合并逻辑。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// mock 底层 vfs（避免 IndexedDB；store 层并发逻辑不依赖存储实现）
const mockVfs = {
  commit: vi.fn(),
  fetch: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  readdir: vi.fn(),
  dirtyFiles: vi.fn(),
};
vi.mock("./vfs", () => ({
  vfs: mockVfs,
  OWNER: "gaubee",
  REPO: "gaubee.com",
  BRANCH: "main",
}));

// mock github/client（vfs 内部依赖，但已被 mock 掉，仍需提供避免加载真实模块）
vi.mock("$lib/github/client", () => ({
  OWNER: "gaubee",
  REPO: "gaubee.com",
  BRANCH: "main",
  getFileText: vi.fn(),
  fetchTree: vi.fn(),
  commitChanges: vi.fn(),
}));

vi.mock("$app/environment", () => ({ browser: true }));

const { vfsStore } = await import("./vfs.svelte");

beforeEach(() => {
  vi.clearAllMocks();
  mockVfs.readdir.mockResolvedValue([]);
  mockVfs.dirtyFiles.mockResolvedValue([]);
});

describe("VfsStore commit 互斥", () => {
  it("并发 commit 合并为一次 vfs.commit 调用", async () => {
    mockVfs.commit.mockImplementation(async () => {
      // 模拟网络延迟，让并发窗口打开
      await new Promise((r) => setTimeout(r, 50));
      return "newsha1234567890";
    });

    // 并发发起两次 commit
    const [sha1, sha2] = await Promise.all([
      vfsStore.commit("msg1"),
      vfsStore.commit("msg2"),
    ]);

    // 两次都拿到同一个 sha（合并）
    expect(sha1).toBe("newsha1234567890");
    expect(sha2).toBe("newsha1234567890");
    // vfs.commit 只调一次（commitInFlight 互斥生效）
    expect(mockVfs.commit).toHaveBeenCalledTimes(1);
  });

  it("串行 commit 各自调用 vfs.commit", async () => {
    mockVfs.commit.mockResolvedValue("sha1");
    await vfsStore.commit("first");
    mockVfs.commit.mockResolvedValue("sha2");
    const sha = await vfsStore.commit("second");
    expect(mockVfs.commit).toHaveBeenCalledTimes(2);
    expect(sha).toBe("sha2");
  });
});

describe("VfsStore sync 合并", () => {
  it("并发 sync 合并为一次 vfs.fetch", async () => {
    mockVfs.fetch.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    await Promise.all([vfsStore.sync(), vfsStore.sync()]);

    // vfs.fetch 只调一次（inFlight 合并）
    expect(mockVfs.fetch).toHaveBeenCalledTimes(1);
  });
});
