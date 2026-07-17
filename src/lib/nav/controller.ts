/**
 * NavController 内核 —— 多区域 tab 路由状态机。
 *
 * 移植自 openspecui（../jixoai-labs/openspecui/packages/web/src/lib/nav-controller.ts），
 * 去掉了 TanStack Router 依赖、远端 KV 同步、hosted session、static mode。
 *
 * 核心思想：
 * - 单条浏览器 URL 编码三个虚拟 area（main / bottom / pop）的 location。
 *   main → pathname，bottom → `?_b=`，pop → `?_p=`。
 * - 所有状态变更走纯函数 reducer（reduceKernel），返回 KernelTransition
 *   （含 nextState + 副作用预算 urlAction/notify/persist），副作用在 dispatch 外执行。
 * - Tab = 预定义路由 id（不是动态对象）。tab 列表 = "哪些 id 当前可见 + 在哪个 area"。
 *
 * 框架无关：本文件不依赖 Svelte / React / 浏览器 API（单例与浏览器初始化在
 * `nav-controller-instance.ts` 中，便于纯函数测试）。
 */

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/**
 * 等价于 TanStack Router 的 HistoryLocation，但不依赖它。
 * 描述一个虚拟的"位置"，含路径、查询、哈希、状态。
 */
export interface HistoryLocation {
  href: string;
  pathname: string;
  search: string;
  hash: string;
  state: HistoryLocationState;
}

export interface HistoryLocationState {
  key: string;
  /** 自定义滚动恢复等任意用户状态 */
  [key: string]: unknown;
}

/**
 * 本项目的 tab 路由 id 枚举。
 * - main 区：内容浏览与编辑的主舞台。
 * - bottom 区：辅助工具面板（git、预览服务器）。
 * - pop 区：模态弹层路由（搜索、通知）单独声明在 POP_ROUTES。
 *
 * 注意：/article/$id、/tags/$tag、/archive/$year/$month 是 main 区的"深链接"，
 * 不作为独立 tab（在 feed/editor 等 tab 内通过链接跳转，仍归属 main area）。
 */
export type TabId =
  // main
  | "/feed"
  | "/editor"
  | "/files"
  | "/changes"
  | "/archive"
  | "/settings"
  // bottom
  | "/git"
  | "/preview-server";

/** pop 区路由集合（不是 tab，是独立的弹层路由）。 */
export const POP_ROUTES = ["/search", "/notifications"] as const;
export type PopRoute = (typeof POP_ROUTES)[number];

export interface NavLayout {
  mainTabs: TabId[];
  bottomTabs: TabId[];
}

interface PersistedNavLayout extends NavLayout {
  updatedAt: number;
}

/** 视图层消费的完整导航状态快照。 */
export interface NavState extends NavLayout {
  mainLocation: HistoryLocation;
  bottomLocation: HistoryLocation;
  popLocation: HistoryLocation;
  /** bottom 区是否展开（location 非 '/'）。 */
  bottomActive: boolean;
  /** pop 区是否展开（location 非 '/'）。 */
  popActive: boolean;
}

export type Area = "main" | "bottom" | "pop";
type BrowserAction = "PUSH" | "REPLACE";
type RouterAction = "PUSH" | "REPLACE" | "BACK";
type PersistEffect = "none" | "local";

interface UrlHistoryState {
  main?: unknown;
  bottom?: unknown;
  pop?: unknown;
}

export interface KernelState extends PersistedNavLayout {
  mainLocation: HistoryLocation;
  bottomLocation: HistoryLocation;
  popLocation: HistoryLocation;
}

/** reducer 输出：新状态 + 副作用预算（不执行副作用）。 */
interface KernelTransition {
  nextState: KernelState;
  changed: boolean;
  /** 是否要 push/replace 浏览器 history。 */
  urlAction?: BrowserAction;
  /** 哪些 area 的位置变了，需要通知订阅者重新渲染。 */
  notify: Array<{ area: Area; type: RouterAction }>;
  /** 是否要持久化到 localStorage。 */
  persist: PersistEffect;
}

type KernelEvent =
  | {
      type: "NAVIGATE";
      sourceArea: Area;
      action: BrowserAction;
      location: HistoryLocation;
    }
  | {
      type: "POPSTATE";
      mainLocation: HistoryLocation;
      bottomLocation: HistoryLocation;
      popLocation: HistoryLocation;
    }
  | { type: "MOVE_TAB"; tabId: TabId; targetArea: "main" | "bottom" }
  | { type: "REORDER"; area: "main" | "bottom"; tabIds: TabId[] }
  | { type: "CLOSE_TAB"; tabId: TabId }
  | { type: "ACTIVATE_BOTTOM"; location: HistoryLocation }
  | { type: "DEACTIVATE_BOTTOM" }
  | { type: "ACTIVATE_POP"; location: HistoryLocation }
  | { type: "DEACTIVATE_POP" }
  | { type: "APPLY_LAYOUT"; layout: PersistedNavLayout; force?: boolean };

type BehaviorEvent = KernelEvent | { type: "BOOTSTRAP" };

type KernelBehaviorPlugin = (ctx: {
  prevState: KernelState;
  nextState: KernelState;
  event: BehaviorEvent;
}) => KernelState;

// ---------------------------------------------------------------------------
// 常量与默认布局
// ---------------------------------------------------------------------------

export const ALL_TABS: readonly TabId[] = [
  "/feed",
  "/editor",
  "/files",
  "/changes",
  "/archive",
  "/settings",
  "/git",
  "/preview-server",
];

/** 默认 main 区 tab（用户可拖拽改变）。 */
export const DEFAULT_MAIN_TABS: TabId[] = [
  "/feed",
  "/editor",
  "/files",
  "/changes",
  "/archive",
  "/settings",
];

/** 默认 bottom 区 tab。 */
export const DEFAULT_BOTTOM_TABS: TabId[] = ["/git", "/preview-server"];

const PERSIST_DEBOUNCE_MS = 300;
const STORAGE_KEY = "gaubee:nav-layout";

// ---------------------------------------------------------------------------
// 工具函数
// ---------------------------------------------------------------------------

function isTabId(value: string): value is TabId {
  return (ALL_TABS as readonly string[]).includes(value);
}

function normalizeTabList(value: unknown): TabId[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is TabId => typeof item === "string" && isTabId(item),
  );
}

function parsePersistedLayout(value: unknown): PersistedNavLayout | null {
  if (typeof value !== "object" || value == null) return null;
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.mainTabs) || !Array.isArray(record.bottomTabs))
    return null;
  return {
    mainTabs: normalizeTabList(record.mainTabs),
    bottomTabs: normalizeTabList(record.bottomTabs),
    updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : 0,
  };
}

function toHistoryLocationState(
  state: unknown,
  fallbackKey: string,
): HistoryLocationState {
  if (typeof state !== "object" || state == null) {
    return { key: fallbackKey };
  }
  const record = state as Record<string, unknown>;
  const key = typeof record.key === "string" ? record.key : fallbackKey;
  return { ...record, key };
}

/** 把字符串 href 解析为 HistoryLocation（不依赖浏览器 origin）。 */
export function parseHref(href: string, state?: unknown): HistoryLocation {
  const url = new URL(href, "http://nav.local");
  const normalizedHref = `${url.pathname}${url.search}${url.hash}`;
  const key = Math.random().toString(36).slice(2);
  return {
    href: normalizedHref,
    pathname: url.pathname || "/",
    search: url.search,
    hash: url.hash,
    state: toHistoryLocationState(state, key),
  };
}

function pathToTabId(path: string): TabId | null {
  for (const tab of ALL_TABS) {
    if (path === tab || path.startsWith(tab + "/")) {
      return tab;
    }
  }
  return null;
}

function activeTabForArea(state: KernelState, area: Area): TabId | null {
  if (area === "pop") return null;
  const location = area === "main" ? state.mainLocation : state.bottomLocation;
  const tabs = area === "main" ? state.mainTabs : state.bottomTabs;
  const tabId = pathToTabId(location.pathname);
  if (!tabId) return null;
  return tabs.includes(tabId) ? tabId : null;
}

export function isPopPath(path: string): boolean {
  return POP_ROUTES.some(
    (route) => path === route || path.startsWith(route + "/"),
  );
}

/** 给定一个路径，判断它属于哪个 area（pop 优先，再看 bottom tab，否则 main）。 */
export function areaForPath(layout: NavLayout, path: string): Area {
  if (isPopPath(path)) return "pop";
  const tabId = pathToTabId(path);
  if (tabId && layout.bottomTabs.includes(tabId)) return "bottom";
  return "main";
}

/** 合并 layout：去重 + 保证 ALL_TABS 全覆盖 + mainTabs/bottomTabs 互斥。 */
function mergeLayout(layout: NavLayout): NavLayout {
  const placed = new Set<TabId>();
  const mainTabs: TabId[] = [];
  const bottomTabs: TabId[] = [];

  for (const tab of layout.mainTabs) {
    if (!placed.has(tab)) {
      mainTabs.push(tab);
      placed.add(tab);
    }
  }
  for (const tab of layout.bottomTabs) {
    if (!placed.has(tab)) {
      bottomTabs.push(tab);
      placed.add(tab);
    }
  }
  for (const tab of ALL_TABS) {
    if (!placed.has(tab)) {
      if (DEFAULT_BOTTOM_TABS.includes(tab)) {
        bottomTabs.push(tab);
      } else {
        mainTabs.push(tab);
      }
    }
  }
  return { mainTabs, bottomTabs };
}

function sanitizeMainLocation(
  location: HistoryLocation,
  mainTabs: readonly TabId[],
): HistoryLocation {
  if (mainTabs.length === 0) return parseHref("/");
  const tabId = pathToTabId(location.pathname);
  if (tabId && !mainTabs.includes(tabId)) {
    return parseHref("/");
  }
  return location;
}

function sanitizeBottomLocation(
  location: HistoryLocation,
  bottomTabs: readonly TabId[],
): HistoryLocation {
  if (bottomTabs.length === 0) return parseHref("/");
  if (location.pathname === "/") return parseHref("/", location.state);
  const tabId = pathToTabId(location.pathname);
  if (!tabId || !bottomTabs.includes(tabId)) {
    return parseHref("/");
  }
  return location;
}

function sanitizePopLocation(location: HistoryLocation): HistoryLocation {
  if (location.pathname === "/") return parseHref("/", location.state);
  if (!isPopPath(location.pathname)) return parseHref("/");
  return location;
}

function normalizeState(state: KernelState): KernelState {
  const merged = mergeLayout({
    mainTabs: state.mainTabs,
    bottomTabs: state.bottomTabs,
  });
  return {
    ...state,
    mainTabs: merged.mainTabs,
    bottomTabs: merged.bottomTabs,
    mainLocation: sanitizeMainLocation(state.mainLocation, merged.mainTabs),
    bottomLocation: sanitizeBottomLocation(
      state.bottomLocation,
      merged.bottomTabs,
    ),
    popLocation: sanitizePopLocation(state.popLocation),
  };
}

// ---------------------------------------------------------------------------
// URL 序列化（单条浏览器 URL ↔ 三份虚拟 location）
// ---------------------------------------------------------------------------

/**
 * 浏览器 URL → 三份 area location。
 * - main 走 pathname + 剩余 search params。
 * - bottom 走 `?_b=<encoded href>`。
 * - pop 走 `?_p=<encoded href>`。
 * - 深链接推断：若 URL 直接指向 bottom/pop 路径且没传 _b/_p，推断归属。
 */
export function parseBrowserLocation(
  loc: Location,
  layout: NavLayout,
): {
  main: HistoryLocation;
  bottom: HistoryLocation;
  pop: HistoryLocation;
} {
  const url = new URL(loc.href);
  const rawBottomHref = url.searchParams.get("_b");
  const rawPopHref = url.searchParams.get("_p");
  url.searchParams.delete("_b");
  url.searchParams.delete("_p");

  const historyState = window.history.state as UrlHistoryState | null;
  let main = parseHref(
    `${url.pathname}${url.search}${url.hash}`,
    historyState?.main,
  );
  let bottom = parseHref(rawBottomHref ?? "/", historyState?.bottom);
  let pop = parseHref(rawPopHref ?? "/", historyState?.pop);

  // 深链接推断：URL 直接指向 bottom/pop 路径但没有显式 _b/_p。
  if (!rawBottomHref && !rawPopHref) {
    const inferredArea = areaForPath(layout, main.pathname);
    if (inferredArea === "bottom") {
      bottom = main;
      main = parseHref("/", historyState?.main);
    } else if (inferredArea === "pop") {
      pop = main;
      main = parseHref("/", historyState?.main);
    }
  }

  return {
    main: sanitizeMainLocation(main, layout.mainTabs),
    bottom: sanitizeBottomLocation(bottom, layout.bottomTabs),
    pop: sanitizePopLocation(pop),
  };
}

/** KernelState → 单条浏览器 URL。 */
export function buildCanonicalUrl(state: KernelState): string {
  const url = new URL(state.mainLocation.href, window.location.origin);
  url.searchParams.delete("_b");
  url.searchParams.delete("_p");

  if (state.bottomTabs.length > 0 && state.bottomLocation.pathname !== "/") {
    url.searchParams.set("_b", state.bottomLocation.href);
  }
  if (state.popLocation.pathname !== "/") {
    url.searchParams.set("_p", state.popLocation.href);
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

// ---------------------------------------------------------------------------
// 持久化（localStorage）
// ---------------------------------------------------------------------------

function readLocalStorage(): PersistedNavLayout | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return parsePersistedLayout(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeLocalStorage(layout: PersistedNavLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// 行为插件（reducer 之后的软性补全）
// ---------------------------------------------------------------------------

/** 拖动当前激活的 tab 到另一区域时，把它当前 location 一起带过去。 */
const carryActiveOnMovePlugin: KernelBehaviorPlugin = ({
  prevState,
  nextState,
  event,
}) => {
  if (event.type !== "MOVE_TAB") return nextState;
  const sourceArea: Area = prevState.bottomTabs.includes(event.tabId)
    ? "bottom"
    : "main";
  const sourceActiveTab = activeTabForArea(prevState, sourceArea);
  if (sourceActiveTab !== event.tabId) return nextState;

  const sourceLocation =
    sourceArea === "main" ? prevState.mainLocation : prevState.bottomLocation;
  const carriedLocation = parseHref(sourceLocation.href, sourceLocation.state);

  if (event.targetArea === "main") {
    return { ...nextState, mainLocation: carriedLocation };
  }
  return { ...nextState, bottomLocation: carriedLocation };
};

/**
 * main 区有 tab 但 location 是 '/'（未激活）时，跳到第一个 tab。
 * 注意：不强制要求 location 指向某个 tab——main 区允许非 tab 的深链接
 * （如 /article/0001、/tags/javascript），这些深链接也是合法的 main location。
 */
const ensureMainHasActivePlugin: KernelBehaviorPlugin = ({ nextState }) => {
  if (nextState.mainTabs.length === 0) return nextState;
  if (nextState.mainLocation.pathname !== "/") return nextState;
  return { ...nextState, mainLocation: parseHref(nextState.mainTabs[0]) };
};

const BUILTIN_BEHAVIOR_PLUGINS: readonly KernelBehaviorPlugin[] = [
  carryActiveOnMovePlugin,
  ensureMainHasActivePlugin,
];

function applyBehaviorPlugins(
  prevState: KernelState,
  nextState: KernelState,
  event: BehaviorEvent,
): KernelState {
  let current = nextState;
  for (const plugin of BUILTIN_BEHAVIOR_PLUGINS) {
    current = plugin({ prevState, nextState: current, event });
  }
  return current;
}

// ---------------------------------------------------------------------------
// reducer（纯函数）
// ---------------------------------------------------------------------------

function areTabsEqual(a: readonly TabId[], b: readonly TabId[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((tab, index) => tab === b[index]);
}

function locationHrefChanged(
  prev: KernelState,
  next: KernelState,
  area: Area,
): boolean {
  const prevLoc =
    area === "main"
      ? prev.mainLocation
      : area === "bottom"
        ? prev.bottomLocation
        : prev.popLocation;
  const nextLoc =
    area === "main"
      ? next.mainLocation
      : area === "bottom"
        ? next.bottomLocation
        : next.popLocation;
  return prevLoc.href !== nextLoc.href;
}

/** 在 transition.notify 基础上，补充因 location href 变化而需要通知的 area。 */
function appendLocationNotifications(
  base: Array<{ area: Area; type: RouterAction }>,
  prev: KernelState,
  next: KernelState,
): Array<{ area: Area; type: RouterAction }> {
  const result = [...base];
  const seen = new Set(base.map((n) => n.area));
  const areas: Area[] = ["main", "bottom", "pop"];
  for (const area of areas) {
    if (!seen.has(area) && locationHrefChanged(prev, next, area)) {
      result.push({ area, type: "REPLACE" });
    }
  }
  return result;
}

export function reduceKernel(
  state: KernelState,
  event: KernelEvent,
): KernelTransition {
  switch (event.type) {
    case "NAVIGATE": {
      const targetArea =
        event.sourceArea === "pop"
          ? "pop"
          : areaForPath(state, event.location.pathname);
      const nextState =
        targetArea === "main"
          ? { ...state, mainLocation: event.location }
          : targetArea === "bottom"
            ? { ...state, bottomLocation: event.location }
            : { ...state, popLocation: event.location };
      return {
        nextState,
        changed: true,
        urlAction: event.action,
        notify:
          targetArea === event.sourceArea
            ? []
            : [{ area: targetArea, type: event.action }],
        persist: "none",
      };
    }

    case "POPSTATE": {
      return {
        nextState: {
          ...state,
          mainLocation: event.mainLocation,
          bottomLocation: event.bottomLocation,
          popLocation: event.popLocation,
        },
        changed: true,
        notify: [
          { area: "main", type: "BACK" },
          { area: "bottom", type: "BACK" },
          { area: "pop", type: "BACK" },
        ],
        persist: "none",
      };
    }

    case "MOVE_TAB": {
      const sourceArea: Area = state.bottomTabs.includes(event.tabId)
        ? "bottom"
        : "main";
      if (sourceArea === event.targetArea) {
        return {
          nextState: state,
          changed: false,
          notify: [],
          persist: "none",
        };
      }
      const mainTabs = state.mainTabs.filter((tab) => tab !== event.tabId);
      const bottomTabs = state.bottomTabs.filter((tab) => tab !== event.tabId);
      const nextMainTabs =
        event.targetArea === "main" ? [...mainTabs, event.tabId] : mainTabs;
      const nextBottomTabs =
        event.targetArea === "bottom"
          ? [...bottomTabs, event.tabId]
          : bottomTabs;

      let mainLocation = state.mainLocation;
      let bottomLocation = state.bottomLocation;
      const sourceLocation =
        sourceArea === "main" ? state.mainLocation : state.bottomLocation;
      if (pathToTabId(sourceLocation.pathname) === event.tabId) {
        if (sourceArea === "main") mainLocation = parseHref("/");
        else bottomLocation = parseHref("/");
      }

      return {
        nextState: {
          ...state,
          mainTabs: nextMainTabs,
          bottomTabs: nextBottomTabs,
          mainLocation,
          bottomLocation,
        },
        changed: true,
        urlAction: "REPLACE",
        notify: [
          { area: "main", type: "REPLACE" },
          { area: "bottom", type: "REPLACE" },
        ],
        persist: "local",
      };
    }

    case "REORDER": {
      const currentTabs =
        event.area === "main" ? state.mainTabs : state.bottomTabs;
      const set = new Set(currentTabs);
      const ordered = event.tabIds.filter((tab) => set.has(tab));
      for (const tab of currentTabs) {
        if (!ordered.includes(tab)) ordered.push(tab);
      }
      if (areTabsEqual(currentTabs, ordered)) {
        return {
          nextState: state,
          changed: false,
          notify: [],
          persist: "none",
        };
      }
      const nextState =
        event.area === "main"
          ? { ...state, mainTabs: ordered }
          : { ...state, bottomTabs: ordered };
      return { nextState, changed: true, notify: [], persist: "local" };
    }

    case "CLOSE_TAB": {
      const inBottom = state.bottomTabs.includes(event.tabId);
      const inMain = state.mainTabs.includes(event.tabId);
      if (!inBottom && !inMain) {
        return {
          nextState: state,
          changed: false,
          notify: [],
          persist: "none",
        };
      }
      if (inBottom) {
        if (pathToTabId(state.bottomLocation.pathname) !== event.tabId) {
          return {
            nextState: state,
            changed: false,
            notify: [],
            persist: "none",
          };
        }
        return {
          nextState: { ...state, bottomLocation: parseHref("/") },
          changed: true,
          urlAction: "REPLACE",
          notify: [],
          persist: "none",
        };
      }
      if (pathToTabId(state.mainLocation.pathname) !== event.tabId) {
        return {
          nextState: state,
          changed: false,
          notify: [],
          persist: "none",
        };
      }
      return {
        nextState: { ...state, mainLocation: parseHref("/") },
        changed: true,
        urlAction: "REPLACE",
        notify: [],
        persist: "none",
      };
    }

    case "ACTIVATE_BOTTOM": {
      if (areaForPath(state, event.location.pathname) !== "bottom") {
        return {
          nextState: state,
          changed: false,
          notify: [],
          persist: "none",
        };
      }
      return {
        nextState: { ...state, bottomLocation: event.location },
        changed: true,
        urlAction: "PUSH",
        notify: [{ area: "bottom", type: "PUSH" }],
        persist: "none",
      };
    }

    case "DEACTIVATE_BOTTOM": {
      if (state.bottomLocation.pathname === "/") {
        return {
          nextState: state,
          changed: false,
          notify: [],
          persist: "none",
        };
      }
      return {
        nextState: { ...state, bottomLocation: parseHref("/") },
        changed: true,
        urlAction: "REPLACE",
        notify: [],
        persist: "none",
      };
    }

    case "ACTIVATE_POP": {
      if (!isPopPath(event.location.pathname)) {
        return {
          nextState: state,
          changed: false,
          notify: [],
          persist: "none",
        };
      }
      return {
        nextState: { ...state, popLocation: event.location },
        changed: true,
        urlAction: "PUSH",
        notify: [{ area: "pop", type: "PUSH" }],
        persist: "none",
      };
    }

    case "DEACTIVATE_POP": {
      if (state.popLocation.pathname === "/") {
        return {
          nextState: state,
          changed: false,
          notify: [],
          persist: "none",
        };
      }
      return {
        nextState: { ...state, popLocation: parseHref("/") },
        changed: true,
        urlAction: "REPLACE",
        notify: [],
        persist: "none",
      };
    }

    case "APPLY_LAYOUT": {
      const merged = mergeLayout(event.layout);
      const changed =
        event.layout.updatedAt !== state.updatedAt ||
        !areTabsEqual(state.mainTabs, merged.mainTabs) ||
        !areTabsEqual(state.bottomTabs, merged.bottomTabs);
      if (
        !changed ||
        (!event.force && event.layout.updatedAt <= state.updatedAt)
      ) {
        return {
          nextState: state,
          changed: false,
          notify: [],
          persist: "none",
        };
      }
      return {
        nextState: {
          ...state,
          mainTabs: merged.mainTabs,
          bottomTabs: merged.bottomTabs,
          updatedAt: event.layout.updatedAt,
        },
        changed: true,
        urlAction: "REPLACE",
        notify: [
          { area: "main", type: "REPLACE" },
          { area: "bottom", type: "REPLACE" },
        ],
        persist: "local",
      };
    }
  }
}

// ---------------------------------------------------------------------------
// NavController 类（外部 store）
// ---------------------------------------------------------------------------

export type NavListener = () => void;

function createInitialState(): KernelState {
  return {
    mainTabs: [...DEFAULT_MAIN_TABS],
    bottomTabs: [...DEFAULT_BOTTOM_TABS],
    updatedAt: 0,
    mainLocation: parseHref("/feed"),
    bottomLocation: parseHref("/"),
    popLocation: parseHref("/"),
  };
}

export class NavController {
  private state: KernelState;
  private listeners = new Set<NavListener>();
  /** snapshot 缓存：避免每次 getSnapshot 都新建对象导致 useSyncExternalStore 无限渲染。 */
  private snapshotCache: NavState | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private popstateHandler: (() => void) | null = null;

  constructor() {
    this.state = createInitialState();
  }

  /** 在浏览器环境初始化：从 localStorage 恢复 + parseBrowserLocation + 注册 popstate。 */
  init(): void {
    if (typeof window === "undefined") return;

    // 1. 从 localStorage 恢复 layout（tabs），location 留给 URL 决定。
    const persisted = readLocalStorage();
    if (persisted) {
      this.state = {
        ...this.state,
        mainTabs: persisted.mainTabs,
        bottomTabs: persisted.bottomTabs,
        updatedAt: persisted.updatedAt,
      };
    }

    // 2. 从浏览器 URL 解析三份 area location。
    const parsed = parseBrowserLocation(window.location, this.state);
    this.state = {
      ...this.state,
      mainLocation: parsed.main,
      bottomLocation: parsed.bottom,
      popLocation: parsed.pop,
    };

    // 3. 行为插件（BOOTSTRAP）+ normalize。
    this.state = applyBehaviorPlugins(this.state, this.state, {
      type: "BOOTSTRAP",
    });
    this.state = normalizeState(this.state);

    // 3.5 根路径 / 重定向到默认主页（mainTabs[0]），避免空白首屏。
    // 仅当 URL 完全是 /（无 query/hash/bottom/pop）时触发。
    if (
      window.location.pathname === "/" &&
      !window.location.search &&
      !window.location.hash &&
      this.state.mainTabs.length > 0 &&
      this.state.mainLocation.pathname === "/"
    ) {
      this.state = {
        ...this.state,
        mainLocation: parseHref(this.state.mainTabs[0]),
      };
    }

    // 4. 把 URL 规范化为 canonical 形式（深链接推断结果写回 URL）。
    const canonical = buildCanonicalUrl(this.state);
    if (
      canonical !==
      `${window.location.pathname}${window.location.search}${window.location.hash}`
    ) {
      window.history.replaceState(this.buildHistoryState(), "", canonical);
    }

    // 5. 注册 popstate 监听。
    this.popstateHandler = () => this.handlePopState();
    window.addEventListener("popstate", this.popstateHandler);
  }

  destroy(): void {
    if (this.popstateHandler) {
      window.removeEventListener("popstate", this.popstateHandler);
      this.popstateHandler = null;
    }
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.listeners.clear();
  }

  // ---- 订阅 ----

  subscribe(listener: NavListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 返回缓存的 NavState 快照（引用稳定，直到下次变更）。 */
  getSnapshot(): NavState {
    if (this.snapshotCache) return this.snapshotCache;
    this.snapshotCache = this.deriveSnapshot();
    return this.snapshotCache;
  }

  private deriveSnapshot(): NavState {
    const s = this.state;
    return {
      mainTabs: [...s.mainTabs],
      bottomTabs: [...s.bottomTabs],
      mainLocation: s.mainLocation,
      bottomLocation: s.bottomLocation,
      popLocation: s.popLocation,
      bottomActive: s.bottomLocation.pathname !== "/",
      popActive: s.popLocation.pathname !== "/",
    };
  }

  private notifyListeners(): void {
    // 清空 snapshot 缓存，让下次 getSnapshot 重新派生。
    this.snapshotCache = null;
    for (const listener of this.listeners) {
      listener();
    }
  }

  // ---- dispatch（单一入口） ----

  private dispatch(event: KernelEvent): void {
    const transition = reduceKernel(this.state, event);
    if (!transition.changed) return;

    const prevState = this.state;
    let nextState = applyBehaviorPlugins(
      prevState,
      transition.nextState,
      event,
    );
    nextState = normalizeState(nextState);
    this.state = nextState;

    // 持久化
    if (transition.persist === "local") {
      this.schedulePersist();
    }

    // URL 同步
    const effectiveUrlAction =
      transition.urlAction ??
      (locationHrefChanged(prevState, this.state, "main") ||
      locationHrefChanged(prevState, this.state, "bottom") ||
      locationHrefChanged(prevState, this.state, "pop")
        ? "REPLACE"
        : undefined);
    if (effectiveUrlAction) {
      this.syncToUrl(effectiveUrlAction);
    }

    // 通知订阅者
    this.notifyListeners();
  }

  private buildHistoryState(): UrlHistoryState {
    return {
      main: this.state.mainLocation.state,
      bottom: this.state.bottomLocation.state,
      pop: this.state.popLocation.state,
    };
  }

  private syncToUrl(action: BrowserAction): void {
    const url = buildCanonicalUrl(this.state);
    const historyState = this.buildHistoryState();
    if (action === "PUSH") {
      window.history.pushState(historyState, "", url);
    } else {
      window.history.replaceState(historyState, "", url);
    }
  }

  private handlePopState(): void {
    const parsed = parseBrowserLocation(window.location, this.state);
    this.dispatch({
      type: "POPSTATE",
      mainLocation: parsed.main,
      bottomLocation: parsed.bottom,
      popLocation: parsed.pop,
    });
  }

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      writeLocalStorage({
        mainTabs: this.state.mainTabs,
        bottomTabs: this.state.bottomTabs,
        updatedAt: Date.now(),
      });
    }, PERSIST_DEBOUNCE_MS);
  }

  // ---- 语义化 API（UI 调用） ----

  /** 导航到某个 location（来源 area 由路径推断）。 */
  navigate(
    sourceArea: Area,
    path: string,
    action: BrowserAction = "PUSH",
  ): void {
    this.dispatch({
      type: "NAVIGATE",
      sourceArea,
      action,
      location: parseHref(path),
    });
  }

  /** main 区导航（便捷方法）。 */
  navigateMain(path: string, action: BrowserAction = "PUSH"): void {
    this.navigate("main", path, action);
  }

  /** 激活 bottom 区（展开 + 导航到 location）。 */
  activateBottom(path: string): void {
    this.dispatch({ type: "ACTIVATE_BOTTOM", location: parseHref(path) });
  }

  /** 收起 bottom 区。 */
  deactivateBottom(): void {
    this.dispatch({ type: "DEACTIVATE_BOTTOM" });
  }

  /** 激活 pop 区（打开弹层 + 导航到 location）。 */
  activatePop(path: string): void {
    this.dispatch({ type: "ACTIVATE_POP", location: parseHref(path) });
  }

  /** 关闭 pop 区。 */
  deactivatePop(): void {
    this.dispatch({ type: "DEACTIVATE_POP" });
  }

  /** 在 main/bottom 之间迁移 tab。 */
  moveTab(tabId: TabId, targetArea: "main" | "bottom"): void {
    this.dispatch({ type: "MOVE_TAB", tabId, targetArea });
  }

  /** 重排某 area 的 tab 列表。 */
  reorder(area: "main" | "bottom", tabIds: TabId[]): void {
    this.dispatch({ type: "REORDER", area, tabIds });
  }

  /** 关闭 tab（如果是活动 tab，对应 area 回到 '/'）。 */
  closeTab(tabId: TabId): void {
    this.dispatch({ type: "CLOSE_TAB", tabId });
  }

  /** 应用一份持久化的 layout（例如从 localStorage 恢复）。 */
  applyLayout(layout: PersistedNavLayout, force = false): void {
    this.dispatch({ type: "APPLY_LAYOUT", layout, force });
  }

  // ---- 只读访问器（给 area outlet / nav 渲染用） ----

  getMainLocation(): HistoryLocation {
    return this.state.mainLocation;
  }
  getBottomLocation(): HistoryLocation {
    return this.state.bottomLocation;
  }
  getPopLocation(): HistoryLocation {
    return this.state.popLocation;
  }
  get mainTabs(): readonly TabId[] {
    return this.state.mainTabs;
  }
  get bottomTabs(): readonly TabId[] {
    return this.state.bottomTabs;
  }
}
