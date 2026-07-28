<!--
	AreaOutlet：区域出口组件。
	接收 area prop，渲染该 area 当前激活的 view。

	main 区双层模型（2026-07-27 路由重构恢复）：
	- entry activity 浮层（z:10）：每个 main 应用一个常驻 AppShell，始终用 entryActivity。
	  应用内多页面通过 entry root 的 children 嵌套表达（如 github 的 list/repo）。
	  ActivityRouter 按 RouteId 缓存组件，应用内保活。
	- 非 entry activity 层（z:20）：当 URL 匹配到非 entry activity（如 articles 的 /article、/tags）
	  时，独立渲染一层 AppShell 覆盖在 tab 浮层之上。tab 浮层隐藏让位但保留 DOM（保活）。
	- NotFound 层（z:30）：URL 无归属应用时渲染。

	这种双层模型解决了「同 tab 切 activity 破坏保活」的问题：
	每个 activity 有独立的 AppShell 实例和 Route 缓存，互不干扰。

	- bottom：所有已注册 tab view 常驻 DOM，display 切换（保活）。
	- pop：不常驻，按需渲染（弹层打开时挂载）。
-->
<script lang="ts">
  import { navStore } from "$lib/nav/nav.svelte";
  import { navController } from "$lib/nav/nav-controller-instance";
  import { getPopLoader } from "$lib/views/registry";
  import { resolveNotFound, type NotFoundResult } from "$lib/views/not-found-registry";
  import { appManager } from "$lib/apps/AppManager.svelte";
  import { appLoadStore } from "$lib/apps/app-load.svelte";
  import { routeDomainRegistry } from "$lib/apps/route-domain";
  import { matchesRoutePrefix } from "$lib/apps/route-domain";
  import type { AppActivity, AppManifest } from "$lib/apps/types";
  import { getEntryRoute } from "$lib/apps/types";
  import { motionBlur } from "$lib/utils/motion";
  import { blurTransition } from "$lib/utils/motion";
  import AppShell from "$lib/app-scaffold/AppShell.svelte";
  import DesktopView from "$lib/apps/views/DesktopView.svelte";
  import NotFoundView from "$lib/views/NotFoundView.svelte";
  import type { Area, HistoryLocation, TabId } from "$lib/nav/controller";
  import type { Component } from "svelte";

  let { area }: { area: Area } = $props();

  const navState = $derived(navStore.current);

  const location = $derived(
    area === "main"
      ? navState.mainLocation
      : area === "bottom"
        ? navState.bottomLocation
        : navState.popLocation,
  );
  const tabIdsInArea = $derived(
    area === "main" ? navState.mainTabs : area === "bottom" ? navState.bottomTabs : [],
  );
  const isActive = $derived(
    area === "main" || (area === "bottom" ? navState.bottomActive : navState.popActive),
  );

  // ---- main 区 Activity 解析（URL-first）----
  // 给定 pathname，找到归属应用 + 匹配的 Activity。
  interface ActivityResolution {
    manifest: AppManifest;
    /** 命中的 activity（最长前缀匹配）。 */
    activity: AppActivity;
    /** 该应用的 entry route（tabId / Dock 身份）。 */
    entryRoute: string;
    /** 命中的 activity 是否就是 entry activity 本身。 */
    isEntry: boolean;
  }
  function resolveActivityForPath(pathname: string): ActivityResolution | null {
    const appId = routeDomainRegistry.appIdForPath(pathname);
    if (!appId) return null;
    const manifest = appManager.findById(appId);
    if (!manifest) return null;
    const entryRoute = getEntryRoute(manifest);
    // 在 activities 中找最长前缀匹配
    let best: AppActivity | undefined;
    for (const a of manifest.activities) {
      if (matchesRoutePrefix(pathname, a.pattern)) {
        if (!best || a.pattern.length > best.pattern.length) best = a;
      }
    }
    // 无精确匹配：让 entry activity 处理（ActivityRouter 会 no-match → 上层 NotFound）
    const activity = best ?? manifest.activities.find((a) => a.entry) ?? manifest.activities[0];
    if (!activity) return null;
    return {
      manifest,
      activity,
      entryRoute,
      isEntry: activity.pattern === entryRoute,
    };
  }

  const mainResolution = $derived(area === "main" ? resolveActivityForPath(location.pathname) : null);

  // 激活的 tab = 归属应用的 entry route（让 Dock 图标在任意子场景下都正确高亮）
  const activeTabId = $derived(
    area === "main"
      ? mainResolution?.entryRoute ?? null
      : activeTabIdForLocation(location, area, tabIdsInArea),
  );

  // ---- bottom 区 tab 激活（旧逻辑，bottom 暂未迁移到 Activity 模型）----
  function activeTabIdForLocation(
    loc: HistoryLocation,
    a: Area,
    tabIds: readonly TabId[],
  ): TabId | null {
    if (a === "pop") return null;
    const path = loc.pathname;
    for (const tabId of tabIds) {
      if (path === tabId || path.startsWith(tabId + "/")) {
        return tabId;
      }
    }
    return null;
  }

  // ---- bottom 区视图加载（从 manifest 派生）----
  // bottom 区应用（terminal）暂未走 Activity 模型，从 manifest.activities[0].root.component 拿 loader。
  // TODO 阶段 5：bottom 区也接入 ActivityRouter 后，删除本块。
  const bottomLoaders = $derived(getAllBottomLoaders());
  const loadedBottomSlots = $state<Array<{ tabId: TabId; component: Component }>>([]);
  const bottomInFlight = new Set<TabId>();
  function loadedBottomFor(tabId: TabId): Component | undefined {
    return loadedBottomSlots.find((s) => s.tabId === tabId)?.component;
  }
  $effect(() => {
    const loaders = bottomLoaders;
    for (const { tabId, loader } of loaders) {
      if (loadedBottomFor(tabId) || bottomInFlight.has(tabId)) continue;
      bottomInFlight.add(tabId);
      appLoadStore.start(tabId);
      loader()
        .then((m) => {
          if (!loadedBottomSlots.some((s) => s.tabId === tabId)) {
            loadedBottomSlots.push({ tabId, component: m.default });
          }
        })
        .finally(() => {
          bottomInFlight.delete(tabId);
          appLoadStore.done(tabId);
        });
    }
  });
  function getAllBottomLoaders(): Array<{ tabId: TabId; loader: () => Promise<{ default: Component }> }> {
    return appManager.allInstalled
      .filter((app) => app.defaultArea === "bottom" && !app.hiddenFromNav)
      .map((app) => {
        const entryActivity = app.activities.find((a) => a.entry) ?? app.activities[0];
        return { tabId: app.route, loader: entryActivity.root.component };
      });
  }

  // ---- pop view 异步加载（非常驻）----
  const popLoader = $derived(
    area === "pop" && navState.popActive ? getPopLoader(location.pathname) : undefined,
  );
  let popView = $state<Component | undefined>(undefined);
  const popCache = new Map<string, Component>();
  const popInFlight = new Set<string>();
  $effect(() => {
    const loader = popLoader;
    const path = location.pathname;
    if (!loader) {
      popView = undefined;
      return;
    }
    const cached = popCache.get(path);
    if (cached) {
      popView = cached;
      return;
    }
    if (popInFlight.has(path)) return;
    popInFlight.add(path);
    appLoadStore.start(`pop:${path}`);
    loader()
      .then((m) => {
        popCache.set(path, m.default);
        popView = m.default;
      })
      .finally(() => {
        popInFlight.delete(path);
        appLoadStore.done(`pop:${path}`);
      });
  });

  // 桌面作为 shell 级背景层（main 区独有）：无应用浮层、无非 entry activity 时显现。
  const isDesktop = $derived(area === "main" && location.pathname === "/");
  const isNotFound = $derived(area === "main" && !isDesktop && mainResolution === null);
  // 非 entry activity 激活时，tab 浮层让位（隐藏但保活）。
  // 例外：hiddenFromNav 应用的 entry activity（如 app-store/account）无常驻 tab，
  // 通过菜单 deep-link 访问时也走这一层渲染（不进 allMainTabs）。
  const nonEntryActive = $derived(
    area === "main" &&
      mainResolution !== null &&
      (!mainResolution.isEntry || mainResolution.manifest.hiddenFromNav),
  );
  const desktopVisible = $derived(
    area === "main" && (isDesktop || (activeTabId === null && !isNotFound)),
  );

  // ---- NotFound 处理 ----
  let lastNotFoundPath = "";
  $effect(() => {
    if (!isNotFound) {
      lastNotFoundPath = "";
      return;
    }
    const path = location.pathname;
    if (path === lastNotFoundPath) return;
    lastNotFoundPath = path;
    const result: NotFoundResult = resolveNotFound(path);
    if (result.kind === "redirect") {
      navController.navigateMain(result.path, "REPLACE");
    }
  });

  // main 区所有 main 应用（按 tabId 常驻保活）。
  const allMainTabs = $derived(
    area === "main"
      ? appManager.allInstalled
          .filter((app) => app.defaultArea === "main" && !app.hiddenFromNav)
          .map((app) => ({
            tabId: app.route,
            manifest: app,
            entryActivity: app.activities.find((a) => a.entry) ?? app.activities[0],
          }))
          .filter((x) => x.entryActivity)
      : [],
  );
</script>

{#if area === "pop"}
  {#if navState.popActive && popView}
    {@const PopView = popView}
    <div in:motionBlur>
      <PopView />
    </div>
  {:else if navState.popActive && popLoader}
    <div class="app-skeleton" aria-label="加载中"></div>
  {/if}
{:else}
  <div class="main-area-root">
    {#if area === "main"}
      <!-- 桌面：shell 级背景层（始终常驻 DOM 保活，无应用浮层时显现） -->
      <div
        class="desktop-layer"
        class:desktop-layer-hidden={!desktopVisible}
        use:blurTransition={{ hiddenClass: "desktop-layer-hidden" }}
      >
        <DesktopView />
      </div>

      <!-- entry activity 浮层（z:10）：每个 main 区应用一个常驻 AppShell（按 tabId 保活）。
           始终用 entryActivity（应用内多页面通过 entry root 的 children 嵌套表达）。
           激活时（activeTabId 命中）显示；非 entry activity 激活时隐藏让位但保留 DOM（保活）。 -->
      {#each allMainTabs as { tabId, manifest, entryActivity } (tabId)}
        {@const isThisActive = isActive && activeTabId === tabId && !nonEntryActive}
        <div
          class="app-overlay-layer"
          class:app-overlay-hidden={!isThisActive}
          use:blurTransition={{ hiddenClass: "app-overlay-hidden" }}
        >
          <AppShell app={manifest} activity={entryActivity} {location} />
        </div>
      {/each}

      <!-- 非 entry activity 层（z:20）：URL 匹配到非 entry activity 时独立渲染。
           与 tab 浮层并存，覆盖其上；tab 浮层隐藏但保留 DOM（保活 scroll/state）。
           常驻 main-area-root，仅当 nonEntryActive 时可见。 -->
      <div class="deep-link-layer" class:deep-link-layer-hidden={!nonEntryActive}>
        {#if nonEntryActive && mainResolution}
          <div class="h-full overflow-auto bg-background">
            <AppShell app={mainResolution.manifest} activity={mainResolution.activity} {location} />
          </div>
        {/if}
      </div>

      <!-- NotFound 层（z:30）：URL 无归属应用时渲染。 -->
      <div class="not-found-layer" class:not-found-layer-hidden={!isNotFound}>
        {#if isNotFound}
          <div class="h-full overflow-auto bg-background" in:motionBlur>
            <NotFoundView path={location.pathname} />
          </div>
        {/if}
      </div>
    {:else if area === "bottom"}
      <!-- bottom 区：旧 registry 机制（terminal 等暂未迁移）-->
      {#each tabIdsInArea as tabId (tabId)}
        {@const isThisActive = isActive && activeTabId === tabId}
        {@const View = loadedBottomFor(tabId)}
        <div
          class="app-overlay-layer"
          class:app-overlay-hidden={!isThisActive}
          use:blurTransition={{ hiddenClass: "app-overlay-hidden" }}
        >
          {#if View}
            {@const BottomView = View}
            <BottomView {area} {tabId} isActive={isThisActive} />
          {:else if isThisActive}
            <div class="app-skeleton h-full" aria-label="加载中"></div>
          {/if}
        </div>
      {/each}
    {/if}
  </div>
{/if}

<style>
  /* main 区根：桌面底层 + 应用浮层的堆叠上下文。 */
  .main-area-root {
    position: relative;
    height: 100%;
    overflow: hidden;
  }
  .desktop-layer {
    position: absolute;
    inset: 0;
    z-index: 1;
    overflow: auto;
  }
  .desktop-layer-hidden {
    visibility: hidden;
    pointer-events: none;
    overflow: hidden;
  }
  .app-overlay-layer {
    position: absolute;
    inset: 0;
    z-index: 10;
    background: var(--background);
    overflow: auto;
  }
  .app-overlay-hidden {
    visibility: hidden;
    pointer-events: none;
    overflow: hidden;
  }
  /* 非 entry activity 详情页层：常驻 main-area-root，激活时（z:20）覆盖 tab 浮层。
   * 与 tab 浮层并存：tab 不卸载、scrollTop 保留；详情页退出时 DOM 移除。 */
  .deep-link-layer {
    position: absolute;
    inset: 0;
    z-index: 20;
  }
  .deep-link-layer-hidden {
    visibility: hidden;
    pointer-events: none;
  }
  .not-found-layer {
    position: absolute;
    inset: 0;
    z-index: 30;
  }
  .not-found-layer-hidden {
    visibility: hidden;
    pointer-events: none;
  }
  .app-skeleton {
    width: 100%;
    min-height: 100%;
    background: var(--muted);
    animation: skeleton-pulse 1.6s ease-in-out infinite;
  }
  @keyframes skeleton-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.55;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .app-skeleton {
      animation: none;
    }
  }
</style>
