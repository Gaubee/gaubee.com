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
  import { navController } from '$lib/nav/nav-controller-instance'
  import {
    getAllTabLoaders,
    activeTabIdForLocation,
    getPopLoader,
  } from '$lib/views/registry'
  import { resolveMainView } from '$lib/views/resolver'
  import { resolveNotFound, type NotFoundResult } from '$lib/views/not-found-registry'
  import { appManager } from '$lib/apps/AppManager.svelte'
  import { appLoadStore } from '$lib/apps/app-load.svelte'
  import { routeDomainRegistry } from '$lib/apps/route-domain'
  import { motionBlur } from '$lib/utils/motion'
  import { blurTransition } from '$lib/utils/motion'
  import AppShell from '$lib/app-scaffold/AppShell.svelte'
  import DesktopView from '$lib/apps/views/DesktopView.svelte'
  import NotFoundView from '$lib/views/NotFoundView.svelte'
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

  // ---- URL-first 视图解析（main 区）----
  // main 区用 resolveMainView（纯 URL 驱动，不查 mainTabs）；
  // bottom 区仍用 activeTabIdForLocation（bottom 有独立的 tab 激活语义）。
  const mainResolution = $derived(
    area === 'main' ? resolveMainView(location.pathname) : null,
  )
  const activeTabId = $derived(
    area === 'main'
      ? mainResolution?.kind === 'tab'
        ? mainResolution.tabId
        : null
      : activeTabIdForLocation(location, area, tabIdsInArea),
  )

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
  // URL-first：deepLink loader 从 resolveMainView 派生（mainResolution.kind === 'deeplink'）。
  // 按路径缓存已加载组件（同一文章二次进入不重复 import）+ inFlight 守卫防 effect 重入死循环。
  const deepLinkLoader = $derived(
    area === 'main' && mainResolution?.kind === 'deeplink' ? mainResolution.loader : undefined,
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

  // 桌面作为 shell 级背景层（main 区独有）：无应用浮层、无 deep-link、非 NotFound 时显现。
  // mainLocation 为 /（桌面）时桌面是顶层（/ 不走视图解析，直接显示桌面）。
  const isDesktop = $derived(area === 'main' && location.pathname === '/')
  const isNotFound = $derived(
    area === 'main' && !isDesktop && mainResolution?.kind === 'not-found',
  )
  const desktopVisible = $derived(
    area === 'main' && (isDesktop || (activeTabId === null && !deepLinkLoader && !isNotFound)),
  )

  // ---- NotFound 处理（方向二）----
  // URL 解析为 not-found 时，跑中间件链；redirect 结果触发导航，render 结果由模板渲染 NotFoundView。
  // 用 lastNotFoundPath 守卫，避免 effect 重入死循环（redirect 后 location 变化重新解析）。
  let lastNotFoundPath = ''
  $effect(() => {
    if (!isNotFound) {
      lastNotFoundPath = ''
      return
    }
    const path = location.pathname
    if (path === lastNotFoundPath) return // 已处理过此路径，避免重入
    lastNotFoundPath = path
    const result: NotFoundResult = resolveNotFound(path)
    if (result.kind === 'redirect') {
      // 中间件要求重定向（如 github 把 /app/github/不存在 重定向到列表页）
      navController.navigateMain(result.path, 'REPLACE')
    }
  })

  // deep-link 详情页激活时，桌面层与 tab 浮层都要让位（隐藏但不卸载，保留 scroll/状态）。
  // 之前的实现把 deep-link 与 tab 放在互斥 {#if} 链里——切换时 tab DOM 整个卸载，
  // scrollTop 与组件状态全部丢失。现在改成并存：详情页叠在 tab 之上（z:20），
  // tab 仍在 DOM 中（visibility:hidden + pointer-events:none），返回时无重挂/无丢状态。
  const deepLinkActive = $derived(area === 'main' && !activeTabId && !!deepLinkLoader)

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
    <div in:motionBlur>
      <PopView />
    </div>
  {:else if navState.popActive && popLoader}
    <div class="app-skeleton" aria-label="加载中"></div>
  {/if}
{:else}
  <div class="main-area-root">
    {#if area === 'main'}
      <!-- 桌面：shell 级背景层（始终常驻 DOM 保活，无应用浮层、无 deep-link 时显现） -->
      <div
        class="desktop-layer"
        class:desktop-layer-hidden={!desktopVisible}
        use:blurTransition={{ hiddenClass: 'desktop-layer-hidden' }}
      >
        <DesktopView />
      </div>
    {/if}
    {#each allTabLoaders as { tabId } (tabId)}
      {@const inThisArea = tabIdsInArea.includes(tabId) || activeTabId === tabId}
      {@const isThisActive = inThisArea && isActive && activeTabId === tabId}
      {@const View = loadedComponentFor(tabId)}
      {@const manifest = manifestForTab(tabId)}
      <!-- 应用浮层：常驻 DOM 保活，激活时覆盖桌面层。显隐用 WAAPI blurIn/blurOut。
           deep-link 详情页激活时也隐藏（让位给详情页），但 DOM 保留以维持 scroll/状态。 -->
      <div
        class="app-overlay-layer"
        class:app-overlay-hidden={!isThisActive || deepLinkActive}
        use:blurTransition={{ hiddenClass: 'app-overlay-hidden' }}
      >
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

    {#if area === 'main'}
      <!-- deep-link 详情页层：与桌面/tab 浮层并存（z:20 覆盖其上）。
           常驻 main-area-root，仅当 deepLinkLoader 激活时可见。
           tab 浮层在此期间隐藏但保留 DOM——根治列表→详情→返回的 scroll/状态丢失。 -->
      {@const manifest = manifestForPath(location.pathname)}
      {@const shellApp = manifest}
      <div class="deep-link-layer" class:deep-link-layer-hidden={!deepLinkActive}>
        {#if deepLinkActive}
          <div class="h-full overflow-auto bg-background">
            {#if deepLinkView}
              {@const DeepView = deepLinkView}
              <div in:motionBlur>
                {#if shellApp}
                  <AppShell app={shellApp} pathname={location.pathname}>
                    <DeepView pathname={location.pathname} />
                  </AppShell>
                {:else}
                  <DeepView pathname={location.pathname} />
                {/if}
              </div>
            {:else}
              <div class="app-skeleton h-full" aria-label="加载中"></div>
            {/if}
          </div>
        {/if}
      </div>
    {/if}

    {#if area === 'main'}
      <!-- NotFound 层（方向二）：URL 解析为 not-found 且中间件未 redirect 时渲染。
           z:30 覆盖桌面/tab/deep-link 之上。 -->
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
  /* main 区根：桌面底层 + 应用浮层的堆叠上下文。
   * 桌面与应用都常驻 DOM（保活），靠 visibility/z-index 决定显隐层级。
   * overflow:hidden 裁剪子层溢出，避免隐藏浮层的内容污染父级 scrollHeight（杜绝滚动嵌套）。
   * 注意：不使用 isolation:isolate——它会创建合成层边界，阻断 .app-layout 系统背景
   * 到后代 .app-icon-box/.widget-card backdrop-filter 的透传。堆叠隔离由 .main-content
   * 的 position:relative + isolation:isolate 提供（见 app.css）。 */
  .main-area-root {
    position: relative;
    height: 100%;
    overflow: hidden;
  }
  /* 桌面层：常驻底层背景。无应用浮层时可见可交互；有浮层时隐藏（被遮挡）。
   * 显隐用 WAAPI blurIn/blurOut 动画（见 use:blurTransition action），visibility 锁交互。
   * 注意：默认态 filter:none（不是 blur(0px)），避免创建合成层影响子元素 backdrop-filter 绘制。 */
  .desktop-layer {
    position: absolute;
    inset: 0;
    z-index: 1;
    overflow: auto;
  }
  .desktop-layer-hidden {
    visibility: hidden;
    pointer-events: none;
    /* 隐藏时不滚动（避免贡献 scrollHeight，虽然被父级 overflow:hidden 裁剪已无害） */
    overflow: hidden;
  }
  /* 应用浮层：常驻 DOM 保活，激活时显示并覆盖桌面。
   * 显隐用 WAAPI blurIn/blurOut 动画（见 use:blurTransition action），visibility 锁交互。
   * 默认态 filter:none，隐藏态 overflow:hidden 避免内容参与父级尺寸计算。
   * 背景保持非透明 var(--background)：App 区域承载 shadcn-ui 组件，
   * 这些组件不是为毛玻璃透传设计的，强行半透明会引入海量样式回归。
   * 透传定制（状态栏/Dock）由 .glass-surface 单独处理（见 app.css）。 */
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
  /* deep-link 详情页层：常驻 main-area-root，激活时（z:20）覆盖桌面+tab 浮层。
   * 与 tab 浮层并存：tab 不卸载、scrollTop 保留；详情页退出时 DOM 移除。
   * 隐藏态用 visibility:hidden 锁交互，但保留布局（避免 main-area-root 高度坍缩）。 */
  .deep-link-layer {
    position: absolute;
    inset: 0;
    z-index: 20;
  }
  .deep-link-layer-hidden {
    visibility: hidden;
    pointer-events: none;
  }
  /* NotFound 层：覆盖桌面/tab/deep-link 之上（z:30）。仅 not-found 解析命中时可见。 */
  .not-found-layer {
    position: absolute;
    inset: 0;
    z-index: 30;
  }
  .not-found-layer-hidden {
    visibility: hidden;
    pointer-events: none;
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
