/**
 * GitService 单元测试。
 *
 * GitService 委托 vfs/vfsStore + accountService。mock 这些依赖，
 * 验证 commit 的鉴权守卫 + 空 dirty 检查 + 委托，以及读写方法委托。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// mock vfs / vfsStore
const mockVfs = {
  readFile: vi.fn(),
  dirtyFiles: vi.fn(),
};
const mockVfsStore = {
  write: vi.fn(),
  commit: vi.fn(),
  revert: vi.fn(),
  sync: vi.fn(),
};
vi.mock("$lib/vfs/vfs.svelte", () => ({
  vfs: mockVfs,
  vfsStore: mockVfsStore,
}));

// mock accountService（GitService.commit 内部鉴权）
const mockAccountService = {
  requireAuthenticated: vi.fn(),
};
vi.mock("$lib/apps/builtin/account/service", () => ({
  accountService: mockAccountService,
}));

const { gitService } = await import("./service");
const { NotAuthenticatedError, NoChangesError } =
  await import("$lib/os/services");

describe("GitService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("commit", () => {
    it("未登录 → 抛 NotAuthenticatedError", async () => {
      mockAccountService.requireAuthenticated.mockImplementation(() => {
        throw new NotAuthenticatedError();
      });
      await expect(gitService.commit("msg")).rejects.toThrow(
        NotAuthenticatedError,
      );
      expect(mockVfsStore.commit).not.toHaveBeenCalled();
    });

    it("空 dirty → 抛 NoChangesError", async () => {
      mockAccountService.requireAuthenticated.mockReturnValue(undefined);
      mockVfs.dirtyFiles.mockResolvedValue([]);
      await expect(gitService.commit("msg")).rejects.toThrow(NoChangesError);
      expect(mockVfsStore.commit).not.toHaveBeenCalled();
    });

    it("正常 → 委托 vfsStore.commit 返回 sha", async () => {
      mockAccountService.requireAuthenticated.mockReturnValue(undefined);
      mockVfs.dirtyFiles.mockResolvedValue([
        {
          path: "a.md",
          content: "x",
          sha: null,
          origin: "local",
          dirty: true,
          mtime: 0,
        },
      ]);
      mockVfsStore.commit.mockResolvedValue("abcdef1234567890");
      const sha = await gitService.commit("msg");
      expect(sha).toBe("abcdef1234567890");
      expect(mockVfsStore.commit).toHaveBeenCalledWith("msg");
    });
  });

  describe("读写委托", () => {
    it("readFile 委托 vfs.readFile", async () => {
      mockVfs.readFile.mockResolvedValue("# content");
      const text = await gitService.readFile("a.md");
      expect(text).toBe("# content");
      expect(mockVfs.readFile).toHaveBeenCalledWith("a.md");
    });

    it("writeFile 委托 vfsStore.write", async () => {
      await gitService.writeFile("a.md", "new");
      expect(mockVfsStore.write).toHaveBeenCalledWith("a.md", "new");
    });

    it("dirtyFiles 委托 vfs.dirtyFiles", async () => {
      mockVfs.dirtyFiles.mockResolvedValue([]);
      await gitService.dirtyFiles();
      expect(mockVfs.dirtyFiles).toHaveBeenCalled();
    });

    it("revert 委托 vfsStore.revert", async () => {
      await gitService.revert("a.md");
      expect(mockVfsStore.revert).toHaveBeenCalledWith("a.md");
    });

    it("sync 委托 vfsStore.sync", async () => {
      await gitService.sync("src/content");
      expect(mockVfsStore.sync).toHaveBeenCalledWith("src/content");
    });
  });
});
