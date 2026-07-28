/**
 * match 单测：Route 树解析。
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineRoute } from "../define-route";
import { matchRouteTree } from "../match";

// 测试用 Route 树（仿 GithubApp 结构）
const rootRoute = defineRoute({
  id: "github",
  pattern: "",
  component: () => Promise.resolve({ default: {} as never }),
  children: [
    defineRoute({
      id: "github.repo.detail",
      pattern: "repo/:owner/:repo",
      params: z.object({ owner: z.string(), repo: z.string() }),
      search: z.object({
        tab: z.enum(["files", "history", "changes", "issues", "log"]).default("files"),
        sha: z.string().optional(),
      }),
      component: () => Promise.resolve({ default: {} as never }),
      children: [
        defineRoute({
          id: "github.repo.detail.file",
          pattern: "file/:path",
          params: z.object({ path: z.string() }),
          component: () => Promise.resolve({ default: {} as never }),
        }),
      ],
    }),
    defineRoute({
      id: "github.list.type",
      pattern: "list/:type",
      params: z.object({ type: z.string() }),
      component: () => Promise.resolve({ default: {} as never }),
    }),
  ],
});

const ACTIVITY_PREFIX = "/app/github";

describe("matchRouteTree - 基础匹配", () => {
  it("root index（空段）命中 root 自身", () => {
    const r = matchRouteTree(rootRoute, "/app/github", "", ACTIVITY_PREFIX);
    expect(r.kind).toBe("matched");
    if (r.kind === "matched") {
      expect(r.chain).toHaveLength(1);
      expect(r.chain[0].route.id).toBe("github");
    }
  });

  it("多段静态+参数命中叶子", () => {
    const r = matchRouteTree(rootRoute, "/app/github/repo/gaubee/gaubee.com", "", ACTIVITY_PREFIX);
    expect(r.kind).toBe("matched");
    if (r.kind === "matched") {
      expect(r.chain).toHaveLength(2);
      expect(r.chain[0].route.id).toBe("github");
      expect(r.chain[1].route.id).toBe("github.repo.detail");
      expect(r.chain[1].rawParams).toEqual({ owner: "gaubee", repo: "gaubee.com" });
    }
  });

  it("嵌套三层（root → detail → commit）命中", () => {
    // 注意：pathname 段不能含 '/'，文件路径等场景应走 search param（如 ?file=src/index.ts）
    const r = matchRouteTree(
      rootRoute,
      "/app/github/repo/gaubee/gaubee.com/file/README",
      "",
      ACTIVITY_PREFIX,
    );
    expect(r.kind).toBe("matched");
    if (r.kind === "matched") {
      expect(r.chain).toHaveLength(3);
      expect(r.chain[2].route.id).toBe("github.repo.detail.file");
      expect(r.chain[2].rawParams).toEqual({ path: "README" });
    }
  });

  it("list/:type 路径命中", () => {
    const r = matchRouteTree(rootRoute, "/app/github/list/favorites", "", ACTIVITY_PREFIX);
    expect(r.kind).toBe("matched");
    if (r.kind === "matched") {
      expect(r.chain[1].route.id).toBe("github.list.type");
      expect(r.chain[1].rawParams).toEqual({ type: "favorites" });
    }
  });
});

describe("matchRouteTree - 无匹配", () => {
  it("未注册的子路径返回 no-match", () => {
    const r = matchRouteTree(rootRoute, "/app/github/unknown", "", ACTIVITY_PREFIX);
    expect(r.kind).toBe("no-match");
  });

  it("Activity 前缀不匹配返回 no-match", () => {
    const r = matchRouteTree(rootRoute, "/app/other", "", ACTIVITY_PREFIX);
    expect(r.kind).toBe("no-match");
  });
});

describe("matchRouteTree - zod parse", () => {
  it("params parse 成功时不报错", () => {
    const r = matchRouteTree(rootRoute, "/app/github/repo/gaubee/gaubee.com", "", ACTIVITY_PREFIX);
    expect(r.kind).toBe("matched");
  });

  it("search 解析（含默认值）", () => {
    const r = matchRouteTree(
      rootRoute,
      "/app/github/repo/gaubee/gaubee.com",
      "?tab=history",
      ACTIVITY_PREFIX,
    );
    expect(r.kind).toBe("matched");
  });

  it("search 枚举非法值 → parse-error", () => {
    const r = matchRouteTree(
      rootRoute,
      "/app/github/repo/gaubee/gaubee.com",
      "?tab=invalid",
      ACTIVITY_PREFIX,
    );
    expect(r.kind).toBe("parse-error");
    if (r.kind === "parse-error") {
      expect(r.reason).toBe("search");
    }
  });

  it("search 提供非法 sha（非 optional 失败）— 这里 sha 是 optional，所以合法", () => {
    // sha 是 optional，空也合法
    const r = matchRouteTree(rootRoute, "/app/github/repo/gaubee/gaubee.com", "", ACTIVITY_PREFIX);
    expect(r.kind).toBe("matched");
  });
});

describe("matchRouteTree - URI 解码", () => {
  it("参数值自动 decodeURIComponent", () => {
    // %40 = @
    const r = matchRouteTree(rootRoute, "/app/github/list/user%40example", "", ACTIVITY_PREFIX);
    expect(r.kind).toBe("matched");
    if (r.kind === "matched") {
      expect(r.chain[1].rawParams).toEqual({ type: "user@example" });
    }
  });
});

describe("matchRouteTree - 子节点声明顺序", () => {
  it("多个 children 时，首个完整匹配者胜出", () => {
    const root = defineRoute({
      id: "test",
      pattern: "",
      component: () => Promise.resolve({ default: {} as never }),
      children: [
        defineRoute({
          id: "test.specific",
          pattern: "specific/:id",
          params: z.object({ id: z.string() }),
          component: () => Promise.resolve({ default: {} as never }),
        }),
        defineRoute({
          id: "test.catchall",
          pattern: ":anything",
          params: z.object({ anything: z.string() }),
          component: () => Promise.resolve({ default: {} as never }),
        }),
      ],
    });
    // 命中 specific（声明在前）
    const r1 = matchRouteTree(root, "/test/specific/abc", "", "/test");
    expect(r1.kind).toBe("matched");
    if (r1.kind === "matched") {
      expect(r1.chain[1].route.id).toBe("test.specific");
    }
    // 单段命中 catchall
    const r2 = matchRouteTree(root, "/test/anything", "", "/test");
    expect(r2.kind).toBe("matched");
    if (r2.kind === "matched") {
      expect(r2.chain[1].route.id).toBe("test.catchall");
    }
  });
});
