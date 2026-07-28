/**
 * defineRoute / defineActivity 单测：运行时自注册 + absolutePattern 回填。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { defineActivity } from "../define-activity";
import { defineRoute } from "../define-route";
import { routeRegistry } from "../registry";

describe("defineRoute - 运行时自注册", () => {
  beforeEach(() => {
    routeRegistry.clear();
  });

  it("顶层 Route 自动注册到 registry", () => {
    const r = defineRoute({
      id: "test.root",
      pattern: "",
      component: () => Promise.resolve({ default: {} as never }),
    });
    expect(routeRegistry.has("test.root")).toBe(true);
    const entry = routeRegistry.get("test.root");
    expect(entry?.route).toBe(r);
    // 顶层 Route 的 absolutePattern 暂为 pattern（待 Activity 挂载回填）
    expect(entry?.absolutePattern).toBe("/");
  });

  it("嵌套子 Route 也自动注册", () => {
    defineRoute({
      id: "parent",
      pattern: "",
      component: () => Promise.resolve({ default: {} as never }),
      children: [
        defineRoute({
          id: "parent.child",
          pattern: "child/:id",
          params: z.object({ id: z.string() }),
          component: () => Promise.resolve({ default: {} as never }),
        }),
      ],
    });
    expect(routeRegistry.has("parent")).toBe(true);
    expect(routeRegistry.has("parent.child")).toBe(true);
  });
});

describe("defineActivity - absolutePattern 回填", () => {
  beforeEach(() => {
    routeRegistry.clear();
  });

  it("defineActivity 覆盖 root 的 absolutePattern", () => {
    const root = defineRoute({
      id: "github",
      pattern: "",
      component: () => Promise.resolve({ default: {} as never }),
    });
    // 挂载前：root 的 absolutePattern 是占位值 '/'
    expect(routeRegistry.get("github")?.absolutePattern).toBe("/");

    defineActivity({
      pattern: "/app/github",
      entry: true,
      root,
    });

    // 挂载后：absolutePattern 被回填为 Activity pattern
    expect(routeRegistry.get("github")?.absolutePattern).toBe("/app/github");
  });

  it("defineActivity 递归回填整棵子树", () => {
    const root = defineRoute({
      id: "github",
      pattern: "",
      component: () => Promise.resolve({ default: {} as never }),
      children: [
        defineRoute({
          id: "github.repo.detail",
          pattern: "repo/:owner/:repo",
          params: z.object({ owner: z.string(), repo: z.string() }),
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
      ],
    });

    // 挂载前：嵌套子 Route 的 absolutePattern 是基于顶层占位拼接
    expect(routeRegistry.get("github.repo.detail")?.absolutePattern).toBe("/repo/:owner/:repo");

    defineActivity({
      pattern: "/app/github",
      entry: true,
      root,
    });

    // 挂载后：全部回填
    expect(routeRegistry.get("github")?.absolutePattern).toBe("/app/github");
    expect(routeRegistry.get("github.repo.detail")?.absolutePattern).toBe(
      "/app/github/repo/:owner/:repo",
    );
    expect(routeRegistry.get("github.repo.detail.file")?.absolutePattern).toBe(
      "/app/github/repo/:owner/:repo/file/:path",
    );
  });
});
