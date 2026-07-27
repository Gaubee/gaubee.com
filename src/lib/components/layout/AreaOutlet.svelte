<!--
	AreaOutlet：区域出口组件。
	接收 area prop，渲染该 area 当前激活的 view。
	- main：桌面背景层 + 应用浮层模型（均常驻 DOM 保活，display 切换显隐）。
	  桌面（/desktop）作底层；激活的非桌面应用以浮层覆盖。
	  每个应用浮层 = 一个 <AppShell activity>，应用内多页面由 ActivityRouter 管理。
	- bottom：所有已注册 tab view 常驻 DOM，display 切换（保活）。
	- pop：不常驻，按需渲染（弹层打开时挂载）。

	版本（2026-07-27 路由重构）：
	- 视图懒加载从 views/registry.ts + placeholders.ts 迁移到 manifest.activities[].root
	- AppShell 内置 ActivityRouter，应用内多页面导航类型安全
	- 跨应用保活仍由 AreaOutlet 的 tab DOM 常驻承担
	- 跨应用的 Activity 匹配由 resolveActivityForPath 承担（替代 resolveMainView）
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

  // ---- Activity 解析（main 区 URL-first）----
  // 给定 pathname，找到归属应用的 manifest + 匹配的 Activity。
  // 决策顺序：
  // 1. 路由域反查 → 应用 entry route（tabId）
  // 2. 在该应用的 activities 中找匹配 pattern 的 activity（最长前缀优先）
  // 3. 都未命中 → not-found
  interface ActivityResolution {
    kind: "tab";
    tabId: TabId;
    manifest: AppManifest;
    activity: AppActivity;
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
    // 若无精确匹配，回落到 entry activity（让 ActivityRouter 处理 no-match）
    const activity = best ?? manifest.activities.find((a) => a.entry) ?? manifest.activities[0];
    if (!activity) return null;
    return { kind: "tab", tabId: entryRoute, manifest, activity };
  }

  const mainResolution = $derived(area === "main" ? resolveActivityForPath(location.pathname) : null);

  const activeTabId = $derived(
    area === "main"
      ? mainResolution?.tabId ?? null
      : activeTabIdForLocation(location, area, tabIdsInArea),
  );

  // ---- bottom 区 tab 激活（沿用旧逻辑，bottom 暂未迁移到 Activity 模型）----
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
    // 读 bottomLoaders 让响应式追踪生效
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

  // 桌面作为 shell 级背景层（main 区独有）：无应用浮层时显现。
  const isDesktop = $derived(area === "main" && location.pathname === "/");
  const isNotFound = $derived(area === "main" && !isDesktop && mainResolution === null);
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

  // main 区所有可能的 tab（用于常驻 DOM 保活）。
  // 不再用全局 placeholders，而是从已安装应用的 entry activities 派生。
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

  // ---- bottom 区注册的 tab loaders（从 manifest 派生）----
  // bottom 区应用（terminal）暂未走 Activity 模型，从 manifest.activities[0].root.component 拿 loader。
  // TODO 阶段 5：bottom 区也接入 ActivityRouter 后，删除本函数。
  function getAllBottomLoaders(): Array<{ tabId: TabId; loader: () => Promise<{ default: Component }> }> {
    return appManager.allInstalled
      .filter((app) => app.defaultArea === "bottom" && !app.hiddenFromNav)
      .map((app) => {
        const entryActivity = app.activities.find((a) => a.entry) ?? app.activities[0];
        return { tabId: app.route, loader: entryActivity.root.component };
      });
  }
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
      <!-- 桌面：shell 级背景层（始终常驻 DOM 保活，无应用浮层、无 deep-link 时显现） -->
      <div
        class="desktop-layer"
        class:desktop-layer-hidden={!desktopVisible}
        use:blurTransition={{ hiddenClass: "desktop-layer-hidden" }}
      >
        <DesktopView />
      </div>
    {/if}

    {#if area === "main"}
      <!-- main 区应用浮层：每个 main 区应用一个常驻 AppShell（按 tabId 保活）。
           激活时（activeTabId 命中）显示，其余隐藏但保留 DOM。 -->
      {#each allMainTabs as { tabId, manifest, entryActivity } (tabId)}
        {@const isThisActive = isActive && activeTabId === tabId}
        {@const activeActivity = isThisActive && mainResolution ? mainResolution.activity : entryActivity}
        <div
          class="app-overlay-layer"
          class:app-overlay-hidden={!isThisActive}
          use:blurTransition={{ hiddenClass: "app-overlay-hidden" }}
        >
          <!-- 即使非激活态也渲染 AppShell（保活）；location 始终用当前 location（激活时 ActivityRouter 自然响应） -->
          <AppShell app={manifest} activity={activeActivity} {location} />
        </div>
      {/each}
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

    {#if area === "main"}
      <!-- NotFound 层：URL 解析为 not-found 且中间件未 redirect 时渲染。 -->
      <div class="not-found-layer" class:not-found-layer-hidden={!isNotFound}>
        {#if isNotFound}
          <div class="h-full overflow-auto bg-background" in:motionBlur>
            <NotFoundView path={location.pathname} />
          </div>
        {/if}
      </div>
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
