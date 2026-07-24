<!--
	AreaOutlet：区域出口组件。
	接收 area prop，渲染该 area 当前激活的 view。
	- main：桌面背景层 + 应用浮层模型（均常驻 DOM 保活，display 切换显隐）。
	  桌面（/desktop）作底层；激活的非桌面应用以浮层覆盖。深链接（/article/...）
	  在无 active tab 时渲染。保活确保切换应用不丢组件状态（编辑器/终端会话等）。
	- bottom：所有已注册 tab view 常驻 DOM，display 切换（保活）。
	- pop：不常驻，按需渲染（弹层打开时挂载）。

	异步加载模型（2026-07-23）：
	- tab view loader 首次触发时异步 import，期间渲染骨架 + 驱动 appLoadStore 进度条。
	- 加载完成后缓存组件，常驻 DOM 保活（与改造前行为一致，只是首屏不预加载全部视图）。
	- deep link / pop view 同样按需异步加载。
-->
<script lang="ts">
  import { navStore } from '$lib/nav/nav.svelte'
  import {
    getAllTabLoaders,
    activeTabIdForLocation,
    getPopLoader,
    getDeepLinkLoader,
  } from '$lib/views/registry'
  import { appManager } from '$lib/apps/AppManager.svelte'
  import { appLoadStore } from '$lib/apps/app-load.svelte'
  import { routeDomainRegistry } from '$lib/apps/route-domain'
  import AppShell from '$lib/app-scaffold/AppShell.svelte'
  import DesktopView from '$lib/apps/views/DesktopView.svelte'
  import type { AppManifest } from '$lib/apps/types'
  import type { Area, TabId } from '$lib/nav/controller'
  import type { Component } from 'svelte'

  let { area }: { area: Area } = $props()

  const navState = $derived(navStore.current)

  const location = $derived(
    area === 'main'
      ? navState.mainLocation
      : area === 'bottom'
        ? navState.bottomLocation
        : navState.popLocation,
  )
  const tabIdsInArea = $derived(
    area === 'main' ? navState.mainTabs : area === 'bottom' ? navState.bottomTabs : [],
  )
  const isActive = $derived(
    area === 'main' || (area === 'bottom' ? navState.bottomActive : navState.popActive),
  )

  const allTabLoaders = $derived(getAllTabLoaders())
  const activeTabId = $derived(activeTabIdForLocation(location, area, tabIdsInArea))

  // ---- tab view 异步加载 + 缓存保活 ----
  // 已加载组件数组（Svelte 5 deep reactivity：push/pop/splice 自动触发响应）。
  const loadedSlots = $state<Array<{ tabId: TabId; component: Component }>>([])
  // 加载中守卫（非响应式，纯逻辑去重，避免 effect 重入重复触发 loader）
  const inFlightTabs = new Set<TabId>()

  function loadedComponentFor(tabId: TabId): Component | undefined {
    return loadedSlots.find((s) => s.tabId === tabId)?.component
  }
  function setLoadedComponent(tabId: TabId, component: Component) {
    if (loadedSlots.some((s) => s.tabId === tabId)) return
    loadedSlots.push({ tabId, component })
  }

  // tab loader 变化时，为每个 loader 触发异步加载
  // 幂等：inFlightTabs 守卫防重入，loadedSlots 缓存避免重复加载
  $effect(() => {
    for (const { tabId, loader } of allTabLoaders) {
      if (loadedComponentFor(tabId) || inFlightTabs.has(tabId)) continue
      inFlightTabs.add(tabId)
      appLoadStore.start(tabId)
      loader()
        .then((m) => setLoadedComponent(tabId, m.default))
        .finally(() => {
          inFlightTabs.delete(tabId)
          appLoadStore.done(tabId)
        })
    }
  })

  // ---- deep link view 异步加载（非常驻）----
  // 按路径缓存已加载组件（同一文章二次进入不重复 import）+ inFlight 守卫防 effect 重入死循环。
  const deepLinkLoader = $derived(
    area === 'main' && !activeTabId ? getDeepLinkLoader(location.pathname) : undefined,
  )
  let deepLinkView = $state<Component | undefined>(undefined)
  const deepLinkCache = new Map<string, Component>()
  const deepLinkInFlight = new Set<string>()
  $effect(() => {
    const loader = deepLinkLoader
    const path = location.pathname
    if (!loader) {
      deepLinkView = undefined
      return
    }
    // 缓存命中：直接用已加载组件，不触发 store/loader
    const cached = deepLinkCache.get(path)
    if (cached) {
      deepLinkView = cached
      return
    }
    // inFlight 守卫：防止 effect 重入重复 start/loader（切断 start/done 死循环）
    if (deepLinkInFlight.has(path)) return
    deepLinkInFlight.add(path)
    appLoadStore.start(`deeplink:${path}`)
    loader()
      .then((m) => {
        deepLinkCache.set(path, m.default)
        deepLinkView = m.default
      })
      .finally(() => {
        deepLinkInFlight.delete(path)
        appLoadStore.done(`deeplink:${path}`)
      })
  })

  // ---- pop view 异步加载（非常驻）----
  // 同 deep link：缓存 + inFlight 守卫。
  const popLoader = $derived(
    area === 'pop' && navState.popActive ? getPopLoader(location.pathname) : undefined,
  )
  let popView = $state<Component | undefined>(undefined)
  const popCache = new Map<string, Component>()
  const popInFlight = new Set<string>()
  $effect(() => {
    const loader = popLoader
    const path = location.pathname
    if (!loader) {
      popView = undefined
      return
    }
    const cached = popCache.get(path)
    if (cached) {
      popView = cached
      return
    }
    if (popInFlight.has(path)) return
    popInFlight.add(path)
    appLoadStore.start(`pop:${path}`)
    loader()
      .then((m) => {
        popCache.set(path, m.default)
        popView = m.default
      })
      .finally(() => {
        popInFlight.delete(path)
        appLoadStore.done(`pop:${path}`)
      })
  })

  // 桌面作为 shell 级背景层（main 区独有）：无应用浮层激活时显现。
  // mainLocation 为 /（桌面）或无激活 tab 时，桌面是顶层。
  const desktopVisible = $derived(
    area === 'main' && (activeTabId === null) && !deepLinkLoader,
  )

  // 按 entry route（tabId）查 manifest，供 AppShell 隔离包裹。
  function manifestForTab(tabId: TabId): AppManifest | undefined {
    return appManager.findByRoute(tabId)
  }
  // 深链接按 path 查归属应用 id → manifest。
  function manifestForPath(path: string): AppManifest | undefined {
    const appId = routeDomainRegistry.appIdForPath(path)
    return appId ? appManager.findById(appId) : undefined
  }
</script>

{#if area === 'pop'}
  {#if navState.popActive && popView}
    {@const PopView = popView}
    <PopView />
  {:else if navState.popActive && popLoader}
    <div class="app-skeleton" aria-label="加载中"></div>
  {/if}
{:else if area === 'main' && !activeTabId && deepLinkLoader}
  {@const manifest = manifestForPath(location.pathname)}
  {@const shellApp = manifest}
  <div class="h-full overflow-auto">
    {#if deepLinkView}
      {@const DeepView = deepLinkView}
      {#if shellApp}
        <AppShell app={shellApp} pathname={location.pathname}>
          <DeepView pathname={location.pathname} />
        </AppShell>
      {:else}
        <DeepView pathname={location.pathname} />
      {/if}
    {:else}
      <div class="app-skeleton h-full" aria-label="加载中"></div>
    {/if}
  </div>
{:else}
  <div class="main-area-root">
    {#if area === 'main'}
      <!-- 桌面：shell 级背景层（始终常驻 DOM 保活，无应用浮层时显现） -->
      <div class="desktop-layer" class:desktop-layer-hidden={!desktopVisible}>
        <DesktopView />
      </div>
    {/if}
    {#each allTabLoaders as { tabId } (tabId)}
      {@const inThisArea = tabIdsInArea.includes(tabId)}
      {@const isThisActive = inThisArea && isActive && activeTabId === tabId}
      {@const View = loadedComponentFor(tabId)}
      {@const manifest = manifestForTab(tabId)}
      <!-- 应用浮层：常驻 DOM 保活（display 切换），激活时覆盖桌面层。 -->
      <div class="app-overlay-layer" class:app-overlay-hidden={!isThisActive}>
        {#if View}
          {#if manifest}
            <AppShell app={manifest} pathname={location.pathname}>
              <View {area} {tabId} isActive={isThisActive} />
            </AppShell>
          {:else}
            <View {area} {tabId} isActive={isThisActive} />
          {/if}
        {:else if isThisActive}
          <!-- 仅激活态显示骨架（隐藏态保活层无需渲染骨架，节省资源） -->
          <div class="app-skeleton h-full" aria-label="加载中"></div>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  /* main 区根：桌面底层 + 应用浮层的堆叠上下文。
   * 桌面与应用都常驻 DOM（保活），靠 visibility/z-index 决定显隐层级。
   * overflow:hidden 裁剪子层溢出，避免隐藏浮层的内容污染父级 scrollHeight（杜绝滚动嵌套）。 */
  .main-area-root {
    position: relative;
    height: 100%;
    isolation: isolate;
    overflow: hidden;
  }
  /* 桌面层：常驻底层背景。无应用浮层时可见可交互；有浮层时隐藏（被遮挡）。
   * 用 visibility/opacity 过渡（display:none 无法 transition）。 */
  .desktop-layer {
    position: absolute;
    inset: 0;
    z-index: 1;
    overflow: auto;
    visibility: visible;
    opacity: 1;
    transition:
      opacity 0.18s ease,
      visibility 0.18s ease;
  }
  .desktop-layer-hidden {
    visibility: hidden;
    opacity: 0;
    pointer-events: none;
    /* 隐藏时不滚动（避免贡献 scrollHeight，虽然被父级 overflow:hidden 裁剪已无害） */
    overflow: hidden;
  }
  /* 应用浮层：常驻 DOM 保活（visibility/opacity 过渡而非 display:none/销毁），
   * 保留组件状态/滚动/编辑器/终端会话。激活时显示并覆盖桌面。
   * 隐藏态 overflow:hidden 避免内容参与父级尺寸计算（杜绝隐藏浮层撑高 scrollHeight）。 */
  .app-overlay-layer {
    position: absolute;
    inset: 0;
    z-index: 10;
    background: var(--background);
    overflow: auto;
    visibility: visible;
    opacity: 1;
    transition:
      opacity 0.2s ease,
      visibility 0.2s ease;
  }
  .app-overlay-hidden {
    visibility: hidden;
    opacity: 0;
    pointer-events: none;
    overflow: hidden;
  }
  /* 加载骨架（shadcn skeleton 风格脉冲） */
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
