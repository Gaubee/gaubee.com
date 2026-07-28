/**
 * navigate 单测：target / buildHref / buildHrefById / goById。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { defineRoute } from "../define-route";
import {
  buildHref,
  buildHrefById,
  go,
  goById,
  routeRegistry,
  setNavControllerAdapter,
  target,
  targetById,
  type NavControllerAdapter,
  type RouteParamsMap,
} from "../navigate";

// 模拟 codegen：通过 declaration merging 扩展 RouteParamsMap，
// 让 targetById/goById/buildHrefById 在测试中拿到编译期类型保护。
declare module "../navigate" {
  interface RouteParamsMap {
    "github.repo.detail": { owner: string; repo: string };
  }
}

const detailRoute = defineRoute({
  id: "github.repo.detail",
  pattern: "repo/:owner/:repo",
  params: z.object({ owner: z.string(), repo: z.string() }),
  search: z.object({ tab: z.enum(["files", "history"]).default("files") }),
  component: () => Promise.resolve({ default: {} as never }),
});

describe("target - 直接 Route 单例", () => {
  it("无 params 时不强制传", () => {
    const noParamRoute = defineRoute({
      id: "x.simple",
      pattern: "simple",
      component: () => Promise.resolve({ default: {} as never }),
    });
    const t = target(noParamRoute);
    expect(t.route).toBe(noParamRoute);
  });

  it("有 params 时构造 target", () => {
    const t = target(detailRoute, { owner: "gaubee", repo: "gaubee.com" });
    expect(t.route).toBe(detailRoute);
    expect(t.params).toEqual({ owner: "gaubee", repo: "gaubee.com" });
  });
});

describe("buildHref - 直接 Route 单例", () => {
  it("拼接父级绝对 pattern + 子级相对", () => {
    const href = buildHref(detailRoute, "/app/github", {
      owner: "gaubee",
      repo: "gaubee.com",
    });
    expect(href).toBe("/app/github/repo/gaubee/gaubee.com");
  });

  it("encode 特殊字符", () => {
    const href = buildHref(detailRoute, "/app/github", {
      owner: "foo bar",
      repo: "x",
    });
    expect(href).toBe("/app/github/repo/foo%20bar/x");
  });
});

describe("buildHrefById - 字符串 RouteId", () => {
  it("未注册的 id 返回 '/'（DEV 警告）", () => {
    routeRegistry.clear();
    // 用 declaration merging 扩展过的 id 测试，避免类型层拒绝
    const href = buildHrefById("github.repo.detail", { owner: "x", repo: "y" });
    expect(href).toBe("/");
  });

  it("注册后正确拼接 absolutePattern", () => {
    routeRegistry.clear();
    routeRegistry.register({
      id: "github.repo.detail",
      route: detailRoute,
      absolutePattern: "/app/github/repo/:owner/:repo",
    });
    const href = buildHrefById("github.repo.detail", {
      owner: "gaubee",
      repo: "gaubee.com",
    });
    expect(href).toBe("/app/github/repo/gaubee/gaubee.com");
  });
});

describe("go / goById - 调用 NavController adapter", () => {
  const mockAdapter: NavControllerAdapter = {
    navigateMain: vi.fn(),
    focusApp: vi.fn(),
    openApp: vi.fn(),
    activatePop: vi.fn(),
    deactivatePop: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setNavControllerAdapter(mockAdapter);
    routeRegistry.clear();
    routeRegistry.register({
      id: "github.repo.detail",
      route: detailRoute,
      absolutePattern: "/app/github/repo/:owner/:repo",
    });
  });

  it("go 调用 navigateMain，传入拼好的 href", () => {
    go(detailRoute, "/app/github", { owner: "a", repo: "b" });
    expect(mockAdapter.navigateMain).toHaveBeenCalledWith("/app/github/repo/a/b");
  });

  it("goById 调用 navigateMain", () => {
    goById("github.repo.detail", { owner: "a", repo: "b" });
    expect(mockAdapter.navigateMain).toHaveBeenCalledWith("/app/github/repo/a/b");
  });
});

describe("targetById - 字符串 id target", () => {
  it("构造 target 不依赖注册表", () => {
    const t = targetById("github.repo.detail", { owner: "a", repo: "b" });
    expect(t.routeId).toBe("github.repo.detail");
    expect(t.params).toEqual({ owner: "a", repo: "b" });
  });
});
