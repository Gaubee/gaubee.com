/**
 * bash 命令内核单元测试。
 *
 * 复用 vfs.test.ts 的 mock 模式（fake-indexeddb + mock GitHub client）。
 * ctx.write 用数组捕获输出，便于断言。
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

const mockGetFileText = vi.fn<(p: string) => Promise<string>>();
const mockFetchTree = vi.fn();
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

// mock 应用服务总线：git 命令走 gaubeeos.requestAppService('git')，
// 返回一个委托真实 vfs 的 git service（鉴权守卫绕过：requireAuthenticated 不抛）。
// account service 默认不可用（null）→ 写命令守卫放行；用 setAccountAuthenticated 可控。
// vfs 在方法调用时动态获取（vi.mock 工厂提升到顶部，此时 vfs 尚未 import）。
const accountState = { authenticated: false, available: false };
function setAccountAuthenticated(authenticated: boolean): void {
  accountState.available = true;
  accountState.authenticated = authenticated;
}
function resetAccount(): void {
  accountState.available = false;
  accountState.authenticated = false;
}
vi.mock("$lib/os/services", () => ({
  gaubeeos: {
    getAppService: (id: string) => {
      if (id === "account" && accountState.available) {
        return { isAuthenticated: accountState.authenticated };
      }
      return null;
    },
    requestAppService: async (id: string) => {
      if (id !== "git") throw new Error(`service ${id} not mocked`);
      const { vfs } = await import("$lib/vfs/vfs");
      return {
        id: "git",
        appId: "github",
        requireAuthenticated() {},
        async dirtyFiles() {
          return vfs.dirtyFiles();
        },
        async commit(message: string) {
          return vfs.commit(message);
        },
        async sync(subtree?: string) {
          return vfs.fetch(subtree);
        },
      };
    },
    hasService: () => true,
  },
  NotAuthenticatedError: class extends Error {},
  NoChangesError: class extends Error {
    constructor() {
      super("没有待提交的变更");
    }
  },
  AppServiceNotInstalled: class extends Error {},
}));

const { vfs } = await import("$lib/vfs/vfs");
const { vfsClear } = await import("$lib/db");
const { runLine, tokenize, resolvePath, prettyCwd, tabComplete } =
  await import("./shell");
import type { CommandContext } from "./shell";

function freshIndexedDB() {
  globalThis.indexedDB = new IDBFactory();
}

beforeAll(() => {
  freshIndexedDB();
});

beforeEach(async () => {
  freshIndexedDB();
  await vfsClear();
  mockGetFileText.mockReset();
  mockFetchTree.mockReset();
  mockCommitChanges.mockReset();
  resetAccount();
});

/** 构造一个 ctx，输出捕获到 out 数组。cwd 默认 src/content。 */
function makeCtx(cwd = "src/content"): { ctx: CommandContext; out: string[] } {
  const out: string[] = [];
  const ctx: CommandContext = {
    cwd,
    vfs,
    write: (s) => out.push(s),
    writeErr: (s) => out.push(s),
    clear: () => out.push("\x1b[2J\x1b[H"),
  };
  return { ctx, out };
}

/** 把输出数组拼成字符串（便于 includes 断言）。 */
function text(out: string[]): string {
  return out.join("");
}

/** 准备一组测试文件。 */
async function seedFixture() {
  await vfs.writeFile("src/content/articles/0001.first.md", "first body");
  await vfs.writeFile("src/content/articles/0002.second.md", "second body");
  await vfs.writeFile("src/content/events/00001.hello.md", "hello event");
  // 清掉 dirty 标记（模拟已同步状态）：commit 模拟一次
  // 这里不 commit，保留 dirty 以便 ls/git status 测试看到黄色标记
}

// ---------------------------------------------------------------------------

describe("tokenize", () => {
  it("空输入返回空数组", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   ")).toEqual([]);
  });

  it("空格分词", () => {
    expect(tokenize("ls -la /tmp")).toEqual(["ls", "-la", "/tmp"]);
  });

  it("单引号保留内部空格", () => {
    expect(tokenize("echo 'hello world'")).toEqual(["echo", "hello world"]);
  });

  it("双引号保留内部空格", () => {
    expect(tokenize('git commit -m "fix: 修复 bug"')).toEqual([
      "git",
      "commit",
      "-m",
      "fix: 修复 bug",
    ]);
  });

  it("反斜杠转义空格", () => {
    expect(tokenize("cat a\\ b.md")).toEqual(["cat", "a b.md"]);
  });

  it("引号内含转义引号", () => {
    expect(tokenize('echo "say \\"hi\\""')).toEqual(["echo", 'say "hi"']);
  });

  it("未闭合引号延伸到行尾", () => {
    expect(tokenize("echo 'unclosed")).toEqual(["echo", "unclosed"]);
  });
});

describe("resolvePath", () => {
  it("相对路径基于 cwd", () => {
    expect(resolvePath("src/content", "articles/0001.md")).toBe(
      "src/content/articles/0001.md",
    );
  });

  it(". 表示当前目录", () => {
    expect(resolvePath("src/content", ".")).toBe("src/content");
  });

  it(".. 弹出上一级", () => {
    expect(resolvePath("src/content/articles", "..")).toBe("src/content");
  });

  it(".. 不能超过根", () => {
    expect(resolvePath("src", "../../../..")).toBe("");
  });

  it("绝对路径从仓库根算", () => {
    expect(resolvePath("src/content", "/README.md")).toBe("README.md");
  });

  it("空 arg 返回 cwd", () => {
    expect(resolvePath("src/content", "")).toBe("src/content");
  });
});

describe("prettyCwd", () => {
  it("加前导斜杠", () => {
    expect(prettyCwd("src/content")).toBe("/src/content");
  });
  it("根目录返回斜杠", () => {
    expect(prettyCwd("")).toBe("/");
  });
});

describe("runLine - 基础命令", () => {
  beforeEach(seedFixture);

  it("ls 列出子目录", async () => {
    const { ctx, out } = makeCtx();
    const res = await runLine(ctx, "ls");
    expect(res.exit).toBe(0);
    // 应列出 articles/ 和 events/ 目录（蓝色 ANSI 包裹）
    const t = text(out);
    expect(t).toContain("articles");
    expect(t).toContain("events");
  });

  it("ls 指定子目录列出文件", async () => {
    const { ctx, out } = makeCtx();
    await runLine(ctx, "ls articles");
    const t = text(out);
    expect(t).toContain("0001.first.md");
    expect(t).toContain("0002.second.md");
  });

  it("cat 输出文件内容", async () => {
    const { ctx, out } = makeCtx();
    const res = await runLine(ctx, "cat articles/0001.first.md");
    expect(res.exit).toBe(0);
    expect(text(out)).toContain("first body");
  });

  it("cat 不存在的文件报错", async () => {
    const { ctx, out } = makeCtx();
    const res = await runLine(ctx, "cat nope.md");
    expect(res.exit).toBe(1);
    expect(text(out)).toContain("文件不存在");
  });

  it("cat 缺少参数报错", async () => {
    const { ctx, out } = makeCtx();
    const res = await runLine(ctx, "cat");
    expect(res.exit).toBe(1);
    expect(text(out)).toContain("缺少文件参数");
  });

  it("echo 回显", async () => {
    const { ctx, out } = makeCtx();
    await runLine(ctx, "echo hello world");
    expect(text(out)).toContain("hello world");
  });

  it("echo 带引号保留空格", async () => {
    const { ctx, out } = makeCtx();
    await runLine(ctx, 'echo "a b c"');
    expect(text(out)).toContain("a b c");
  });

  it("pwd 输出当前目录", async () => {
    const { ctx, out } = makeCtx("src/content/articles");
    await runLine(ctx, "pwd");
    expect(text(out)).toContain("/src/content/articles");
  });

  it("pwd 根目录", async () => {
    const { ctx, out } = makeCtx("");
    await runLine(ctx, "pwd");
    expect(text(out)).toContain("/");
  });

  it("touch 创建空文件", async () => {
    const { ctx } = makeCtx();
    await runLine(ctx, "touch articles/0099.new.md");
    const stat = await vfs.stat("src/content/articles/0099.new.md");
    expect(stat).not.toBeNull();
    const content = await vfs.readFile("src/content/articles/0099.new.md");
    expect(content).toBe("");
  });

  it("write 写入文件", async () => {
    const { ctx } = makeCtx();
    await runLine(ctx, "write articles/0099.x.md hello content");
    const content = await vfs.readFile("src/content/articles/0099.x.md");
    expect(content).toBe("hello content");
  });

  it("rm 删除文件", async () => {
    const { ctx } = makeCtx();
    const res = await runLine(ctx, "rm articles/0001.first.md");
    expect(res.exit).toBe(0);
    const stat = await vfs.stat("src/content/articles/0001.first.md");
    // VFS 软删除：stat 仍返回节点但 content=null
    expect(stat?.content).toBeNull();
  });

  it("rm 不存在的文件报错", async () => {
    const { ctx, out } = makeCtx();
    const res = await runLine(ctx, "rm articles/nope.md");
    expect(res.exit).toBe(1);
    expect(text(out)).toContain("文件不存在");
  });

  it("stat 显示元数据", async () => {
    const { ctx, out } = makeCtx();
    await runLine(ctx, "stat articles/0001.first.md");
    const t = text(out);
    expect(t).toContain("0001.first.md");
    expect(t).toContain("已修改"); // seedFixture 写入后是 dirty
  });

  it("find 递归列出", async () => {
    const { ctx, out } = makeCtx();
    await runLine(ctx, "find articles");
    const t = text(out);
    expect(t).toContain("0001.first.md");
    expect(t).toContain("0002.second.md");
  });

  it("find -name 过滤", async () => {
    const { ctx, out } = makeCtx();
    await runLine(ctx, "find articles -name second");
    const t = text(out);
    expect(t).toContain("0002.second.md");
    expect(t).not.toContain("0001.first.md");
  });

  it("clear 调用 clear 回调", async () => {
    const { ctx, out } = makeCtx();
    await runLine(ctx, "clear");
    expect(text(out)).toContain("\x1b[2J");
  });

  it("未知命令返回 127", async () => {
    const { ctx, out } = makeCtx();
    const res = await runLine(ctx, "nonexistentcmd");
    expect(res.exit).toBe(127);
    expect(text(out)).toContain("命令未找到");
  });

  it("help 列出命令", async () => {
    const { ctx, out } = makeCtx();
    await runLine(ctx, "help");
    const t = text(out);
    expect(t).toContain("可用命令");
    expect(t).toContain("ls");
    expect(t).toContain("git");
  });

  it("help <cmd> 显示详细说明", async () => {
    const { ctx, out } = makeCtx();
    await runLine(ctx, "help cat");
    const t = text(out);
    expect(t).toContain("输出文件内容");
  });

  it("空行返回 0", async () => {
    const { ctx } = makeCtx();
    const res = await runLine(ctx, "");
    expect(res.exit).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 写命令鉴权守卫：未登录时 rm/touch/write 被拦截
// ---------------------------------------------------------------------------

describe("写命令鉴权守卫", () => {
  beforeEach(async () => {
    await seedFixture();
  });

  it("未登录时 rm 被拦截，不删除文件", async () => {
    setAccountAuthenticated(false);
    const { ctx, out } = makeCtx();
    const res = await runLine(ctx, "rm articles/0001.first.md");
    expect(res.exit).toBe(1);
    expect(text(out)).toContain("需要先登录");
    // 文件仍在（未被软删除）
    const stat = await vfs.stat("src/content/articles/0001.first.md");
    expect(stat?.content).toBe("first body");
  });

  it("未登录时 touch 被拦截，不创建文件", async () => {
    setAccountAuthenticated(false);
    const { ctx, out } = makeCtx();
    const res = await runLine(ctx, "touch articles/0099.new.md");
    expect(res.exit).toBe(1);
    expect(text(out)).toContain("需要先登录");
    const stat = await vfs.stat("src/content/articles/0099.new.md");
    expect(stat).toBeNull();
  });

  it("未登录时 write 被拦截，不写入文件", async () => {
    setAccountAuthenticated(false);
    const { ctx, out } = makeCtx();
    const res = await runLine(ctx, "write articles/0099.x.md hello");
    expect(res.exit).toBe(1);
    expect(text(out)).toContain("需要先登录");
    const stat = await vfs.stat("src/content/articles/0099.x.md");
    expect(stat).toBeNull();
  });

  it("已登录时写命令正常工作", async () => {
    setAccountAuthenticated(true);
    const { ctx } = makeCtx();
    const res = await runLine(ctx, "write articles/0099.x.md hello content");
    expect(res.exit).toBe(0);
    const content = await vfs.readFile("src/content/articles/0099.x.md");
    expect(content).toBe("hello content");
  });

  it("account service 不可用时写命令放行（无法判定登录态）", async () => {
    // resetAccount 已在全局 beforeEach 调用，accountState.available = false
    const { ctx } = makeCtx();
    const res = await runLine(ctx, "write articles/0099.x.md ok");
    expect(res.exit).toBe(0);
    const content = await vfs.readFile("src/content/articles/0099.x.md");
    expect(content).toBe("ok");
  });
});

describe("runLine - cd", () => {
  beforeEach(seedFixture);

  it("cd 切到子目录返回 newCwd", async () => {
    const { ctx } = makeCtx();
    const res = await runLine(ctx, "cd articles");
    expect(res.exit).toBe(0);
    expect(res.newCwd).toBe("src/content/articles");
  });

  it("cd 无参数回到根", async () => {
    const { ctx } = makeCtx("src/content/articles");
    const res = await runLine(ctx, "cd");
    expect(res.newCwd).toBe("");
  });

  it("cd 到文件报错", async () => {
    const { ctx, out } = makeCtx();
    const res = await runLine(ctx, "cd articles/0001.first.md");
    expect(res.exit).toBe(1);
    expect(res.newCwd).toBeNull();
    expect(text(out)).toContain("不是目录");
  });

  it("cd 用 .. 返回上级", async () => {
    const { ctx } = makeCtx("src/content/articles");
    const res = await runLine(ctx, "cd ..");
    expect(res.newCwd).toBe("src/content");
  });
});

describe("runLine - git", () => {
  beforeEach(seedFixture);

  it("git status 列出 dirty", async () => {
    const { ctx, out } = makeCtx();
    const res = await runLine(ctx, "git status");
    expect(res.exit).toBe(0);
    const t = text(out);
    expect(t).toContain("0001.first.md");
    expect(t).toContain("modified");
  });

  it("git status 干净时提示", async () => {
    // 先 commit 清掉 dirty
    mockCommitChanges.mockResolvedValue("newsha1234567890");
    await vfs.commit("init");
    const { ctx, out } = makeCtx();
    await runLine(ctx, "git status");
    expect(text(out)).toContain("工作区干净");
  });

  it("git commit -m 提交并清 dirty", async () => {
    mockCommitChanges.mockResolvedValue("abcdef1234567890");
    const { ctx, out } = makeCtx();
    const res = await runLine(ctx, 'git commit -m "test message"');
    expect(res.exit).toBe(0);
    expect(mockCommitChanges).toHaveBeenCalled();
    const t = text(out);
    expect(t).toContain("abcdef1");
    expect(t).toContain("test message");
    // dirty 应清空
    const dirty = await vfs.dirtyFiles();
    expect(dirty.length).toBe(0);
  });

  it("git commit 无 -m 报错", async () => {
    const { ctx, out } = makeCtx();
    const res = await runLine(ctx, "git commit");
    expect(res.exit).toBe(1);
    expect(text(out)).toContain("缺少 -m");
  });

  it("git commit 空 dirty 报错", async () => {
    mockCommitChanges.mockResolvedValue("sha0000000000");
    await vfs.commit("init");
    const { ctx, out } = makeCtx();
    const res = await runLine(ctx, 'git commit -m "x"');
    expect(res.exit).toBe(1);
    expect(text(out)).toContain("没有待提交的变更");
  });

  it("git 不支持的子命令报错", async () => {
    const { ctx, out } = makeCtx();
    const res = await runLine(ctx, "git push");
    expect(res.exit).toBe(1);
    expect(text(out)).toContain("不支持子命令");
  });
});

describe("tabComplete", () => {
  beforeEach(seedFixture);

  it("命令位置补全命令名", async () => {
    const { ctx } = makeCtx();
    const cands = await tabComplete(ctx, "ca");
    expect(cands).toContain("cat");
  });

  it("路径补全", async () => {
    const { ctx } = makeCtx();
    const cands = await tabComplete(ctx, "ls art");
    expect(cands.some((c) => c.includes("articles"))).toBe(true);
  });

  it("补全子目录内文件", async () => {
    const { ctx } = makeCtx();
    const cands = await tabComplete(ctx, "cat articles/0001");
    expect(cands.some((c) => c.includes("0001.first.md"))).toBe(true);
  });

  it("无匹配返回空", async () => {
    const { ctx } = makeCtx();
    const cands = await tabComplete(ctx, "cat articles/zzz");
    expect(cands).toEqual([]);
  });
});
