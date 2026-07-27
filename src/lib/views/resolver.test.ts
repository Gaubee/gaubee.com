import { routeDomainRegistry } from "$lib/apps/route-domain";
import type { AppManifest } from "$lib/apps/types";
import { leafRoute } from "$lib/router";
import { registerTabView, registerDeepLinkView } from "$lib/views/registry";
import { resolveMainView } from "$lib/views/resolver";
/**
 * resolver 单元测试（server project，纯逻辑）。
 *
 * resolveMainView 是 URL-first 视图解析的核心：路由域反查 → tabView / deepLink / not-found。
 * 测试用唯一前缀 /__resolver_test__/ 隔离，避免与真实 placeholders.ts 注册冲突。
 *
 * 注意（2026-07-27 路由重构后）：resolveMainView 已被 AreaOutlet 内联的 resolveActivityForPath
 * 取代，本测试保留以验证旧 resolver.ts 仍可用于 deep link 视图解析（pop 浮层等）。
 * 阶段 5 删除 resolver.ts 时一并删除。
 */
import { describe, expect, it, beforeEach } from "vitest";

const PREFIX = "/__resolver_test__";
const Loader = () => Promise.resolve({ default: (() => {}) as never });

function makeManifest(
  id: string,
  activities: Array<{ pattern: string; entry?: boolean }>,
): AppManifest {
  return {
    id,
    name: id,
    icon: (() => {}) as never,
    category: "default",
    defaultArea: "main",
    activities: activities.map((a) => ({
      pattern: a.pattern,
      entry: a.entry,
      root: leafRoute(id, Loader),
    })),
  };
}

beforeEach(() => {
  routeDomainRegistry.clear();
});

describe("resolveMainView", () => {
  it("路由域命中 entry route → tabView", () => {
    const m = makeManifest("test-tab", [{ pattern: `${PREFIX}/app`, entry: true }]);
    routeDomainRegistry.registerApp(m);
    registerTabView(`${PREFIX}/app`, Loader);

    const r = resolveMainView(`${PREFIX}/app`);
    expect(r.kind).toBe("tab");
    if (r.kind === "tab") expect(r.tabId).toBe(`${PREFIX}/app`);
  });

  it("路由域命中 entry route 子路径 → tabView（最长前缀）", () => {
    const m = makeManifest("test-tab-sub", [{ pattern: `${PREFIX}/app2`, entry: true }]);
    routeDomainRegistry.registerApp(m);
    registerTabView(`${PREFIX}/app2`, Loader);

    const r = resolveMainView(`${PREFIX}/app2/repo/owner/name`);
    expect(r.kind).toBe("tab");
    if (r.kind === "tab") expect(r.tabId).toBe(`${PREFIX}/app2`);
  });

  it("entry route 命中但无 tabLoader（hiddenFromNav 应用）→ 走 deepLink 分支", () => {
    const m = makeManifest("test-hidden", [{ pattern: `${PREFIX}/hidden`, entry: true }]);
    routeDomainRegistry.registerApp(m);
    // 不注册 tabView，注册 deepLinkView
    registerDeepLinkView(`${PREFIX}/hidden`, Loader);

    const r = resolveMainView(`${PREFIX}/hidden`);
    expect(r.kind).toBe("deeplink");
  });

  it("deepLink 前缀匹配命中", () => {
    registerDeepLinkView(`${PREFIX}/article`, Loader);
    const r = resolveMainView(`${PREFIX}/article/0001/foo`);
    expect(r.kind).toBe("deeplink");
  });

  it("都不命中 → not-found", () => {
    const r = resolveMainView(`${PREFIX}/nonexistent`);
    expect(r.kind).toBe("not-found");
  });

  it("根路径 / → not-found（桌面由 AreaOutlet 单独处理，不归 resolver）", () => {
    const r = resolveMainView("/");
    // / 不匹配任何路由域/deepLink，返回 not-found；AreaOutlet 的 desktopVisible 会优先判定
    expect(r.kind).toBe("not-found");
  });
});
