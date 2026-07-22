/**
 * views/registry 单元测试：视图注册表的注册、查询、前缀匹配。
 *
 * registry 是模块级单例（Map 累积），测试用唯一前缀 /__test__/ 避免与
 * placeholders.ts 注册的真实路由冲突。注册是幂等的（同 pattern 重复 push，
 * getDeepLinkView 取第一个匹配）。
 */
import { describe, expect, it } from "vitest";
import type { Component } from "svelte";
import {
  activeTabIdForLocation,
  getAllTabViews,
  getDeepLinkView,
  getPopView,
  getTabView,
  registerDeepLinkView,
  registerPopView,
  registerTabView,
} from "./registry";
import type { HistoryLocation } from "$lib/nav/controller";

// 测试用空组件（registry 只存引用，不实际渲染）
const DummyA: Component = (() => {}) as unknown as Component;
const DummyB: Component = (() => {}) as unknown as Component;

function makeLoc(pathname: string): HistoryLocation {
  return {
    href: pathname,
    pathname,
    search: "",
    hash: "",
    state: { key: "test" },
  };
}

describe("registerTabView / getTabView", () => {
  it("注册后可按 tabId 查询", () => {
    const id = "/__test__/tab-a" as const;
    registerTabView(id, DummyA);
    expect(getTabView(id)).toBe(DummyA);
  });

  it("未注册的 tabId 返回 undefined", () => {
    expect(getTabView("/__test__/nonexistent")).toBeUndefined();
  });

  it("覆盖注册（同 tabId 再注册替换组件）", () => {
    const id = "/__test__/tab-overwrite" as const;
    registerTabView(id, DummyA);
    registerTabView(id, DummyB);
    expect(getTabView(id)).toBe(DummyB);
  });
});

describe("getAllTabViews", () => {
  it("返回所有已注册的 tab view（含 tabId 与 component）", () => {
    const before = getAllTabViews().length;
    const id = "/__test__/tab-all" as const;
    registerTabView(id, DummyA);
    const after = getAllTabViews();
    expect(after.length).toBe(before + 1);
    expect(after.some((e) => e.tabId === id && e.component === DummyA)).toBe(
      true,
    );
  });
});

describe("registerPopView / getPopView", () => {
  it("精确匹配 pop 路由", () => {
    const route = "/__test__/pop";
    registerPopView(route, DummyA);
    expect(getPopView(route)).toBe(DummyA);
  });

  it("前缀匹配：子路径匹配父 pop 路由", () => {
    const route = "/__test__/pop-prefix";
    registerPopView(route, DummyA);
    expect(getPopView(`${route}/sub`)).toBe(DummyA);
  });

  it("未注册路由返回 undefined", () => {
    expect(getPopView("/__test__/pop-nope")).toBeUndefined();
  });
});

describe("registerDeepLinkView / getDeepLinkView", () => {
  it("精确匹配 deep link pattern", () => {
    const pattern = "/__test__/deep";
    registerDeepLinkView(pattern, DummyA);
    expect(getDeepLinkView(pattern)).toBe(DummyA);
  });

  it("前缀匹配：以 pattern + / 开头的路径", () => {
    const pattern = "/__test__/deep-prefix";
    registerDeepLinkView(pattern, DummyA);
    expect(getDeepLinkView(`${pattern}/articles/0001`)).toBe(DummyA);
  });

  it("返回第一个匹配的 pattern（注册顺序优先）", () => {
    // 更具体的 pattern 先注册时应优先匹配
    const specific = "/__test__/deep-order/specific";
    const general = "/__test__/deep-order";
    registerDeepLinkView(specific, DummyA);
    registerDeepLinkView(general, DummyB);
    // /__test__/deep-order/specific/xxx 应匹配 specific（先注册）
    expect(getDeepLinkView(`${specific}/xxx`)).toBe(DummyA);
  });

  it("无匹配返回 undefined", () => {
    expect(getDeepLinkView("/__test__/deep-nope")).toBeUndefined();
  });
});

describe("activeTabIdForLocation", () => {
  const tabIds = ["/__test__/main-a", "/__test__/main-b"] as const;

  it("pop 区始终返回 null", () => {
    expect(
      activeTabIdForLocation(makeLoc("/__test__/main-a"), "pop", tabIds),
    ).toBeNull();
  });

  it("main 区：location 匹配某 tab 返回该 tabId", () => {
    expect(
      activeTabIdForLocation(makeLoc("/__test__/main-a"), "main", tabIds),
    ).toBe("/__test__/main-a");
  });

  it("main 区：location 是 tab 的子路径返回该 tabId", () => {
    expect(
      activeTabIdForLocation(makeLoc("/__test__/main-b/sub"), "main", tabIds),
    ).toBe("/__test__/main-b");
  });

  it("main 区：location 不匹配任何 tab 返回 null（深链接场景）", () => {
    expect(
      activeTabIdForLocation(makeLoc("/article/0001"), "main", tabIds),
    ).toBeNull();
  });

  it("bottom 区：同 main 逻辑（匹配 tab 或子路径）", () => {
    expect(
      activeTabIdForLocation(makeLoc("/__test__/main-a"), "bottom", tabIds),
    ).toBe("/__test__/main-a");
  });
});
