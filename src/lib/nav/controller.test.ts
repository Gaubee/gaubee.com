/**
 * NavController 内核单元测试。
 *
 * 覆盖：reducer 每个 case、URL 序列化往返、sanitize/merge、行为插件。
 * 注意：reducer 测试是纯函数；URL 序列化测试用 vi.stubGlobal 模拟 window。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ALL_TABS,
  DEFAULT_BOTTOM_TABS,
  DEFAULT_MAIN_TABS,
  POP_ROUTES,
  areaForPath,
  buildCanonicalUrl,
  isPopPath,
  parseBrowserLocation,
  parseHref,
  reduceKernel,
  NavController,
  type HistoryLocation,
  type KernelState,
  type TabId,
} from "./controller";

// ---------------------------------------------------------------------------
// 辅助：构造初始 state 与 location
// ---------------------------------------------------------------------------

function makeLocation(path: string): HistoryLocation {
  return parseHref(path);
}

function makeInitialState(): KernelState {
  return {
    mainTabs: [...DEFAULT_MAIN_TABS],
    bottomTabs: [...DEFAULT_BOTTOM_TABS],
    updatedAt: 0,
    mainLocation: parseHref("/app/articles"),
    bottomLocation: parseHref("/"),
    popLocation: parseHref("/"),
  };
}

// ---------------------------------------------------------------------------
// parseHref / 基础工具
// ---------------------------------------------------------------------------

describe("parseHref", () => {
  it("解析纯路径", () => {
    const loc = parseHref("/app/articles");
    expect(loc.pathname).toBe("/app/articles");
    expect(loc.search).toBe("");
    expect(loc.hash).toBe("");
    expect(loc.href).toBe("/app/articles");
    expect(typeof loc.state.key).toBe("string");
  });

  it("解析带查询与哈希", () => {
    const loc = parseHref("/article/0001?tab=comments#section-1");
    expect(loc.pathname).toBe("/article/0001");
    expect(loc.search).toBe("?tab=comments");
    expect(loc.hash).toBe("#section-1");
    expect(loc.href).toBe("/article/0001?tab=comments#section-1");
  });

  it("空路径归一化为 /", () => {
    const loc = parseHref("");
    expect(loc.pathname).toBe("/");
  });
});

// ---------------------------------------------------------------------------
// areaForPath / isPopPath
// ---------------------------------------------------------------------------

describe("areaForPath", () => {
  const layout = {
    mainTabs: DEFAULT_MAIN_TABS,
    bottomTabs: DEFAULT_BOTTOM_TABS,
  };

  it("pop 路径优先", () => {
    expect(areaForPath(layout, "/app/search")).toBe("pop");
    expect(areaForPath(layout, "/app/notifications")).toBe("pop");
    // 注意：areaForPath 接收 pathname（已剥离 query），不处理带 query 的字符串。
    // /app/search/sub 是 pop（子路径），但 /app/search?q=foo 由调用方先剥离 query。
  });

  it("bottom tab 路径", () => {
    expect(areaForPath(layout, "/app/github")).toBe("bottom");
    expect(areaForPath(layout, "/app/github/something")).toBe("bottom");
    expect(areaForPath(layout, "/app/terminal")).toBe("bottom");
  });

  it("其余归 main（含非 tab 的深链接，如 /article/0001）", () => {
    expect(areaForPath(layout, "/app/articles")).toBe("main");
    expect(areaForPath(layout, "/article/0001")).toBe("main");
    expect(areaForPath(layout, "/tags/javascript")).toBe("main");
    expect(areaForPath(layout, "/unknown-path")).toBe("main");
  });
});

describe("isPopPath", () => {
  it("POP_ROUTES 全部识别", () => {
    for (const route of POP_ROUTES) {
      expect(isPopPath(route)).toBe(true);
      expect(isPopPath(`${route}/sub`)).toBe(true);
    }
  });

  it("非 pop 路径", () => {
    expect(isPopPath("/app/articles")).toBe(false);
    expect(isPopPath("/app/github")).toBe(false);
    expect(isPopPath("/")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// reduceKernel —— NAVIGATE
// ---------------------------------------------------------------------------

describe("reduceKernel: NAVIGATE", () => {
  it("main 内导航（sourceArea=main，目标 main）：不跨区，无额外 notify", () => {
    const state = makeInitialState();
    const result = reduceKernel(state, {
      type: "NAVIGATE",
      sourceArea: "main",
      action: "PUSH",
      location: makeLocation("/article/0001"),
    });
    expect(result.changed).toBe(true);
    expect(result.nextState.mainLocation.pathname).toBe("/article/0001");
    expect(result.urlAction).toBe("PUSH");
    expect(result.notify).toEqual([]);
  });

  it("跨区导航：main 点击 /git 链接，目标变 bottom，notify bottom", () => {
    const state = makeInitialState();
    const result = reduceKernel(state, {
      type: "NAVIGATE",
      sourceArea: "main",
      action: "PUSH",
      location: makeLocation("/app/github"),
    });
    expect(result.nextState.bottomLocation.pathname).toBe("/app/github");
    expect(result.nextState.mainLocation.pathname).toBe("/app/articles"); // main 不变
    expect(result.notify).toEqual([{ area: "bottom", type: "PUSH" }]);
  });

  it("pop 路径导航：sourceArea=main 点 search，进 pop", () => {
    const state = makeInitialState();
    const result = reduceKernel(state, {
      type: "NAVIGATE",
      sourceArea: "main",
      action: "PUSH",
      location: makeLocation("/app/search"),
    });
    expect(result.nextState.popLocation.pathname).toBe("/app/search");
    expect(result.notify).toEqual([{ area: "pop", type: "PUSH" }]);
  });

  it("sourceArea=pop 时强制 targetArea=pop", () => {
    const state = makeInitialState();
    const result = reduceKernel(state, {
      type: "NAVIGATE",
      sourceArea: "pop",
      action: "PUSH",
      location: makeLocation("/app/notifications"),
    });
    expect(result.nextState.popLocation.pathname).toBe("/app/notifications");
  });
});

// ---------------------------------------------------------------------------
// reduceKernel —— MOVE_TAB
// ---------------------------------------------------------------------------

describe("reduceKernel: MOVE_TAB", () => {
  it("main → bottom：tab 从 mainTabs 移到 bottomTabs", () => {
    const state = makeInitialState();
    const tabToMove = "/app/settings";
    expect(state.mainTabs).toContain(tabToMove);
    const result = reduceKernel(state, {
      type: "MOVE_TAB",
      tabId: tabToMove,
      targetArea: "bottom",
    });
    expect(result.nextState.mainTabs).not.toContain(tabToMove);
    expect(result.nextState.bottomTabs).toContain(tabToMove);
    expect(result.persist).toBe("local");
  });

  it("同 area 移动：changed=false", () => {
    const state = makeInitialState();
    const result = reduceKernel(state, {
      type: "MOVE_TAB",
      tabId: "/app/settings",
      targetArea: "main",
    });
    expect(result.changed).toBe(false);
  });

  it("移动当前激活的 tab：source area location 清空", () => {
    const state = makeInitialState();
    // /feed 是初始 main location，把它移到 bottom
    const result = reduceKernel(state, {
      type: "MOVE_TAB",
      tabId: "/app/articles",
      targetArea: "bottom",
    });
    expect(result.nextState.mainLocation.pathname).toBe("/");
  });
});

// ---------------------------------------------------------------------------
// reduceKernel —— REORDER
// ---------------------------------------------------------------------------

describe("reduceKernel: REORDER", () => {
  it("重排 main tabs", () => {
    const state = makeInitialState();
    const newOrder: TabId[] = [
      "/app/shout",
      "/app/articles",
      ...state.mainTabs.slice(2),
    ];
    const result = reduceKernel(state, {
      type: "REORDER",
      area: "main",
      tabIds: newOrder,
    });
    expect(result.nextState.mainTabs.slice(0, 2)).toEqual([
      "/app/shout",
      "/app/articles",
    ]);
    expect(result.persist).toBe("local");
  });

  it("相同顺序：changed=false", () => {
    const state = makeInitialState();
    const result = reduceKernel(state, {
      type: "REORDER",
      area: "main",
      tabIds: [...state.mainTabs],
    });
    expect(result.changed).toBe(false);
  });

  it("部分列表自动补全缺失 tab", () => {
    const state = makeInitialState();
    const result = reduceKernel(state, {
      type: "REORDER",
      area: "main",
      tabIds: ["/app/shout"], // 只给一个，其余应被追加
    });
    expect(result.nextState.mainTabs).toHaveLength(state.mainTabs.length);
    expect(result.nextState.mainTabs[0]).toBe("/app/shout");
    // 补全的 tab 保留原相对顺序
    expect(result.nextState.mainTabs.slice(1)).toEqual(
      state.mainTabs.filter((t: string) => t !== "/app/shout"),
    );
  });

  it("过滤掉不属于该 area 的 tab", () => {
    const state = makeInitialState();
    const result = reduceKernel(state, {
      type: "REORDER",
      area: "main",
      tabIds: ["/app/articles", "/app/github"], // /git 不在 main
    });
    expect(result.nextState.mainTabs).not.toContain("/app/github");
  });
});

// ---------------------------------------------------------------------------
// reduceKernel —— CLOSE_TAB
// ---------------------------------------------------------------------------

describe("reduceKernel: CLOSE_TAB", () => {
  it("关闭非活动 tab：无变化（tab 列表不在 CLOSE_TAB 职责内，仅清 location）", () => {
    const state = makeInitialState();
    // /files 不是当前 main 活动 tab（/feed 才是）
    const result = reduceKernel(state, {
      type: "CLOSE_TAB",
      tabId: "/app/settings",
    });
    expect(result.changed).toBe(false);
  });

  it("关闭当前活动 main tab：location 回 /", () => {
    const state = makeInitialState();
    const result = reduceKernel(state, {
      type: "CLOSE_TAB",
      tabId: "/app/articles",
    });
    expect(result.changed).toBe(true);
    expect(result.nextState.mainLocation.pathname).toBe("/");
  });

  it("关闭不存在的 tab：无变化", () => {
    const state = makeInitialState();
    // 先把 /git 从 bottom 移除以构造一个不在任何 area 的场景
    const moved = reduceKernel(state, {
      type: "MOVE_TAB",
      tabId: "/app/github",
      targetArea: "main",
    });
    // /git 现在在 main，关闭它如果是活动的才有效
    const result = reduceKernel(moved.nextState, {
      type: "CLOSE_TAB",
      tabId: "/app/github",
    });
    // /git 不是 main 活动 tab（活动是 /feed），所以无变化
    expect(result.changed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// reduceKernel —— ACTIVATE/DEACTIVATE BOTTOM/POP
// ---------------------------------------------------------------------------

describe("reduceKernel: ACTIVATE_BOTTOM / DEACTIVATE_BOTTOM", () => {
  it("激活 bottom：location 必须属于 bottom area", () => {
    const state = makeInitialState();
    const r1 = reduceKernel(state, {
      type: "ACTIVATE_BOTTOM",
      location: makeLocation("/app/github"),
    });
    expect(r1.changed).toBe(true);
    expect(r1.nextState.bottomLocation.pathname).toBe("/app/github");

    // 非 bottom 路径拒绝
    const r2 = reduceKernel(state, {
      type: "ACTIVATE_BOTTOM",
      location: makeLocation("/app/articles"),
    });
    expect(r2.changed).toBe(false);
  });

  it("收起 bottom", () => {
    const state: KernelState = {
      ...makeInitialState(),
      bottomLocation: makeLocation("/app/github"),
    };
    const result = reduceKernel(state, { type: "DEACTIVATE_BOTTOM" });
    expect(result.nextState.bottomLocation.pathname).toBe("/");
  });

  it("收起已收起的 bottom：无变化", () => {
    const state = makeInitialState();
    const result = reduceKernel(state, { type: "DEACTIVATE_BOTTOM" });
    expect(result.changed).toBe(false);
  });
});

describe("reduceKernel: ACTIVATE_POP / DEACTIVATE_POP", () => {
  it("激活 pop：location 必须是 pop 路径", () => {
    const state = makeInitialState();
    const r1 = reduceKernel(state, {
      type: "ACTIVATE_POP",
      location: makeLocation("/app/search"),
    });
    expect(r1.nextState.popLocation.pathname).toBe("/app/search");

    const r2 = reduceKernel(state, {
      type: "ACTIVATE_POP",
      location: makeLocation("/app/articles"),
    });
    expect(r2.changed).toBe(false);
  });

  it("关闭 pop", () => {
    const state: KernelState = {
      ...makeInitialState(),
      popLocation: makeLocation("/app/search"),
    };
    const result = reduceKernel(state, { type: "DEACTIVATE_POP" });
    expect(result.nextState.popLocation.pathname).toBe("/");
  });
});

// ---------------------------------------------------------------------------
// reduceKernel —— POPSTATE
// ---------------------------------------------------------------------------

describe("reduceKernel: POPSTATE", () => {
  it("三份 location 全替换，三 area 全通知 BACK", () => {
    const state = makeInitialState();
    const result = reduceKernel(state, {
      type: "POPSTATE",
      mainLocation: makeLocation("/article/0001"),
      bottomLocation: makeLocation("/app/github"),
      popLocation: makeLocation("/app/search"),
    });
    expect(result.nextState.mainLocation.pathname).toBe("/article/0001");
    expect(result.nextState.bottomLocation.pathname).toBe("/app/github");
    expect(result.nextState.popLocation.pathname).toBe("/app/search");
    expect(result.notify).toEqual([
      { area: "main", type: "BACK" },
      { area: "bottom", type: "BACK" },
      { area: "pop", type: "BACK" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// URL 序列化往返（parseBrowserLocation ↔ buildCanonicalUrl）
// ---------------------------------------------------------------------------

/**
 * buildCanonicalUrl 依赖 window.location.origin；parseBrowserLocation 依赖
 * window.location.href + window.history.state。用 vi.stubGlobal 模拟 window，
 * afterEach 恢复，确保测试间隔离。
 */
function mockWindow(href: string, historyState: unknown = null) {
  const url = new URL(href, "http://localhost");
  vi.stubGlobal("window", {
    location: url,
    history: { state: historyState },
  });
}

describe("URL 序列化往返", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it("纯 main URL：往返保持一致", () => {
    mockWindow("http://localhost/app/articles");
    const layout = {
      mainTabs: DEFAULT_MAIN_TABS,
      bottomTabs: DEFAULT_BOTTOM_TABS,
    };
    const parsed = parseBrowserLocation(window.location, layout);
    expect(parsed.main.pathname).toBe("/app/articles");
    expect(parsed.bottom.pathname).toBe("/");
    expect(parsed.pop.pathname).toBe("/");
  });

  it("带 _b 的 URL：bottom location 解析", () => {
    mockWindow("http://localhost/app/articles?_b=/app/github");
    const layout = {
      mainTabs: DEFAULT_MAIN_TABS,
      bottomTabs: DEFAULT_BOTTOM_TABS,
    };
    const parsed = parseBrowserLocation(window.location, layout);
    expect(parsed.main.pathname).toBe("/app/articles");
    expect(parsed.bottom.pathname).toBe("/app/github");
    expect(parsed.pop.pathname).toBe("/");
  });

  it("带 _p 的 URL：pop location 解析", () => {
    mockWindow("http://localhost/app/articles?_p=/app/search");
    const layout = {
      mainTabs: DEFAULT_MAIN_TABS,
      bottomTabs: DEFAULT_BOTTOM_TABS,
    };
    const parsed = parseBrowserLocation(window.location, layout);
    expect(parsed.main.pathname).toBe("/app/articles");
    expect(parsed.pop.pathname).toBe("/app/search");
  });

  it("深链接推断：URL 直接是 bottom 路径且无 _b，推断为 bottom", () => {
    mockWindow("http://localhost/app/github");
    const layout = {
      mainTabs: DEFAULT_MAIN_TABS,
      bottomTabs: DEFAULT_BOTTOM_TABS,
    };
    const parsed = parseBrowserLocation(window.location, layout);
    // /app/github 被识别为 bottom，main 回 /
    expect(parsed.bottom.pathname).toBe("/app/github");
    expect(parsed.main.pathname).toBe("/");
  });

  it("深链接推断：URL 直接是 pop 路径且无 _p，推断为 pop", () => {
    mockWindow("http://localhost/app/search");
    const layout = {
      mainTabs: DEFAULT_MAIN_TABS,
      bottomTabs: DEFAULT_BOTTOM_TABS,
    };
    const parsed = parseBrowserLocation(window.location, layout);
    expect(parsed.pop.pathname).toBe("/app/search");
    expect(parsed.main.pathname).toBe("/");
  });

  it("buildCanonicalUrl：main + bottom + pop 全编码（/ 会被编码为 %2F）", () => {
    mockWindow("http://localhost/app/articles");
    const state: KernelState = {
      mainTabs: DEFAULT_MAIN_TABS,
      bottomTabs: DEFAULT_BOTTOM_TABS,
      updatedAt: 0,
      mainLocation: makeLocation("/article/0001"),
      bottomLocation: makeLocation("/app/github"),
      popLocation: makeLocation("/app/search"),
    };
    const url = buildCanonicalUrl(state);
    expect(url).toContain("/article/0001");
    // URLSearchParams 会把 / 编码为 %2F
    expect(url).toContain("_b=%2Fapp%2Fgithub");
    expect(url).toContain("_p=%2Fapp%2Fsearch");
    // 解码后能还原
    const parsedUrl = new URL(url, "http://localhost");
    expect(parsedUrl.searchParams.get("_b")).toBe("/app/github");
    expect(parsedUrl.searchParams.get("_p")).toBe("/app/search");
  });

  it("buildCanonicalUrl：bottom/pop 未激活时不编码 _b/_p", () => {
    mockWindow("http://localhost/app/articles");
    const state: KernelState = {
      mainTabs: DEFAULT_MAIN_TABS,
      bottomTabs: DEFAULT_BOTTOM_TABS,
      updatedAt: 0,
      mainLocation: makeLocation("/app/articles"),
      bottomLocation: makeLocation("/"),
      popLocation: makeLocation("/"),
    };
    const url = buildCanonicalUrl(state);
    expect(url).toBe("/app/articles");
    expect(url).not.toContain("_b");
    expect(url).not.toContain("_p");
  });
});

// ---------------------------------------------------------------------------
// ALL_TABS / 默认布局不变量
// ---------------------------------------------------------------------------

describe("默认布局不变量", () => {
  it("ALL_TABS 覆盖 main + bottom", () => {
    const allInDefaults = [...DEFAULT_MAIN_TABS, ...DEFAULT_BOTTOM_TABS];
    for (const tab of ALL_TABS) {
      expect(allInDefaults).toContain(tab);
    }
  });

  it("main 与 bottom 默认不重叠", () => {
    const intersection = DEFAULT_MAIN_TABS.filter((t) =>
      DEFAULT_BOTTOM_TABS.includes(t),
    );
    expect(intersection).toEqual([]);
  });

  it("POP_ROUTES 与 ALL_TABS 不重叠", () => {
    for (const route of POP_ROUTES) {
      expect(ALL_TABS).not.toContain(route);
    }
  });
});

// ---------------------------------------------------------------------------
// NavController 实例：深链接保活 + 订阅快照
// ---------------------------------------------------------------------------

describe("NavController 实例", () => {
  // 实例的 dispatch 会 syncToUrl（访问 window），需要 stub window + history。
  beforeEach(() => {
    const url = new URL("http://localhost/app/articles");
    const historyState: { state: unknown } = { state: null };
    vi.stubGlobal("window", {
      location: url,
      history: {
        state: null,
        pushState: (s: unknown) => {
          historyState.state = s;
        },
        replaceState: (s: unknown) => {
          historyState.state = s;
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("navigate 到非 tab 深链接（/article/0001）保留在 main，不被插件重置", () => {
    const controller = new NavController();
    // 初始 mainLocation 是 /feed（DEFAULT_MAIN_TABS[0]）
    expect(controller.getSnapshot().mainLocation.pathname).toBe(
      "/app/articles",
    );
    controller.navigateMain("/article/0001");
    const snap = controller.getSnapshot();
    expect(snap.mainLocation.pathname).toBe("/article/0001");
  });

  it("订阅：navigate 后 listener 被触发，snapshot 引用变化", () => {
    const controller = new NavController();
    let callCount = 0;
    controller.subscribe(() => {
      callCount++;
    });
    const snap1 = controller.getSnapshot();
    controller.navigateMain("/app/settings");
    expect(callCount).toBe(1);
    const snap2 = controller.getSnapshot();
    expect(snap2).not.toBe(snap1); // 引用变化
    expect(snap2.mainLocation.pathname).toBe("/app/settings");
  });

  it("未变化的 dispatch 不触发 listener", () => {
    const controller = new NavController();
    let callCount = 0;
    controller.subscribe(() => {
      callCount++;
    });
    // DEACTIVATE_BOTTOM 在已收起状态下无变化
    controller.deactivateBottom();
    expect(callCount).toBe(0);
  });

  it("moveTab 后 mainTabs/bottomTabs 更新，snapshot 反映", () => {
    const controller = new NavController();
    controller.moveTab("/app/github", "main");
    const snap = controller.getSnapshot();
    expect(snap.mainTabs).toContain("/app/github");
    expect(snap.bottomTabs).not.toContain("/app/github");
  });

  it("getSnapshot 返回的 mainTabs/bottomTabs 是副本（外部修改不影响内部）", () => {
    const controller = new NavController();
    const snap = controller.getSnapshot();
    const original = [...snap.mainTabs];
    snap.mainTabs.push("/app/github"); // 外部破坏性修改
    // 再次获取 snapshot（缓存被清空后重新派生），应恢复
    controller.navigateMain("/app/articles"); // 触发 notify 清缓存
    const snap2 = controller.getSnapshot();
    expect(snap2.mainTabs).toEqual(original);
  });
});
