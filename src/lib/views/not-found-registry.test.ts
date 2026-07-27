import { routeDomainRegistry } from "$lib/apps/route-domain";
import type { AppManifest } from "$lib/apps/types";
import { leafRoute } from "$lib/router";
import {
  registerNotFoundHandler,
  unregisterNotFoundHandler,
  resolveNotFound,
  _clearNotFoundHandlersForTest,
  type NotFoundResult,
} from "$lib/views/not-found-registry";
/**
 * not-found-registry 单元测试（server project，纯逻辑）。
 *
 * 验证中间件链执行：归属应用优先 → 全局 → 默认 render，redirect 短路。
 */
import { describe, expect, it, beforeEach } from "vitest";

const Loader = () => Promise.resolve({ default: (() => {}) as never });

function makeManifest(id: string, route: string): AppManifest {
  return {
    id,
    name: id,
    icon: (() => {}) as never,
    category: "default",
    defaultArea: "main",
    activities: [{ pattern: route, entry: true, root: leafRoute(id, Loader) }],
  };
}

beforeEach(() => {
  routeDomainRegistry.clear();
  _clearNotFoundHandlersForTest();
});

describe("resolveNotFound", () => {
  it("无 handler 注册 → 默认 render", () => {
    const r = resolveNotFound("/nonexistent");
    expect(r.kind).toBe("render");
  });

  it("归属应用 handler 返回 redirect → 短路", () => {
    routeDomainRegistry.registerApp(makeManifest("app-a", "/app/a"));
    registerNotFoundHandler({
      appId: "app-a",
      handle: (ctx, next) => {
        if (ctx.appId === "app-a") return { kind: "redirect", path: "/app/a" };
        return next();
      },
    });

    const r = resolveNotFound("/app/a/nonexistent");
    expect(r.kind).toBe("redirect");
    if (r.kind === "redirect") expect(r.path).toBe("/app/a");
  });

  it("归属应用 handler 放行 → 全局 handler 接管", () => {
    routeDomainRegistry.registerApp(makeManifest("app-b", "/app/b"));
    registerNotFoundHandler({
      appId: "app-b",
      handle: (_ctx, next) => next(), // 放行
    });
    registerNotFoundHandler({
      appId: "global-catch",
      handle: () => ({ kind: "redirect", path: "/fallback" }),
    });

    const r = resolveNotFound("/app/b/nonexistent");
    expect(r.kind).toBe("redirect");
    if (r.kind === "redirect") expect(r.path).toBe("/fallback");
  });

  it("所有 handler 都放行 → 默认 render", () => {
    routeDomainRegistry.registerApp(makeManifest("app-c", "/app/c"));
    registerNotFoundHandler({
      appId: "app-c",
      handle: (_ctx, next) => next(),
    });

    const r = resolveNotFound("/app/c/nonexistent");
    expect(r.kind).toBe("render");
  });

  it("无归属应用的路径 → 全局 handler 处理", () => {
    registerNotFoundHandler({
      appId: "global",
      handle: () => ({ kind: "redirect", path: "/global-fallback" }),
    });

    const r = resolveNotFound("/totally/orphan/path");
    expect(r.kind).toBe("redirect");
    if (r.kind === "redirect") expect(r.path).toBe("/global-fallback");
  });

  it("unregisterNotFoundHandler 移除指定应用 handler", () => {
    registerNotFoundHandler({
      appId: "temp-app",
      handle: () => ({ kind: "redirect", path: "/temp" }),
    });
    expect(resolveNotFound("/x").kind).toBe("redirect");

    unregisterNotFoundHandler("temp-app");
    const r: NotFoundResult = resolveNotFound("/x");
    expect(r.kind).toBe("render");
  });

  it("ctx.path 和 ctx.appId 正确传递", () => {
    routeDomainRegistry.registerApp(makeManifest("ctx-app", "/app/ctx"));
    let captured: { path: string; appId: string | null } | null = null;
    registerNotFoundHandler({
      appId: "ctx-app",
      handle: (ctx, next) => {
        captured = ctx;
        return next();
      },
    });

    resolveNotFound("/app/ctx/deep");
    expect(captured).toEqual({ path: "/app/ctx/deep", appId: "ctx-app" });
  });
});
