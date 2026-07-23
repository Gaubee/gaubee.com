<!--
	AreaOutlet：区域出口组件。
	接收 area prop，渲染该 area 当前激活的 view。
	- main：桌面背景层 + 应用浮层模型（均常驻 DOM 保活，display 切换显隐）。
	  桌面（/desktop）作底层；激活的非桌面应用以浮层覆盖。深链接（/article/...）
	  在无 active tab 时渲染。保活确保切换应用不丢组件状态（编辑器/终端会话等）。
	- bottom：所有已注册 tab view 常驻 DOM，display 切换（保活）。
	- pop：不常驻，按需渲染（弹层打开时挂载）。
-->
<script lang="ts">
  import { navStore } from '$lib/nav/nav.svelte'
  import {
    getAllTabViews,
    activeTabIdForLocation,
    getPopView,
    getDeepLinkView,
  } from '$lib/views/registry'
  import { appManager } from '$lib/apps/AppManager.svelte'
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
        : navState.popLocation
  )
  const tabIdsInArea = $derived(
    area === 'main' ? navState.mainTabs : area === 'bottom' ? navState.bottomTabs : []
  )
  const isActive = $derived(
    area === 'main' || (area === 'bottom' ? navState.bottomActive : navState.popActive)
  )

  const allTabViews = $derived(getAllTabViews())
  const activeTabId = $derived(activeTabIdForLocation(location, area, tabIdsInArea))

  // 深链接 view（activeTabId 为 null 时）
  const deepLinkView = $derived(
    area === 'main' && !activeTabId ? getDeepLinkView(location.pathname) : undefined
  )

  const popView = $derived(
    area === 'pop' && navState.popActive ? getPopView(location.pathname) : undefined
  )

  const tabEntries = $derived(allTabViews as ReadonlyArray<{ tabId: TabId; component: Component }>)

  // 桌面作为 shell 级背景层（main 区独有）：无应用浮层激活时显现。
  // mainLocation 为 /（桌面）或无激活 tab 时，桌面是顶层。
  const desktopVisible = $derived(
    area === 'main' && (activeTabId === null) && !deepLinkView,
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
  {/if}
{:else if area === 'main' && !activeTabId && deepLinkView}
  {@const DeepView = deepLinkView}
  {@const manifest = manifestForPath(location.pathname)}
  {@const shellApp = manifest}
  {#if shellApp}
    <AppShell app={shellApp} pathname={location.pathname}>
      <DeepView pathname={location.pathname} />
    </AppShell>
  {:else}
    <div class="h-full">
      <DeepView pathname={location.pathname} />
    </div>
  {/if}
{:else}
  <div class="main-area-root">
    {#if area === 'main'}
      <!-- 桌面：shell 级背景层（始终常驻 DOM 保活，无应用浮层时显现） -->
      <div class="desktop-layer" class:desktop-layer-hidden={!desktopVisible}>
        <DesktopView />
      </div>
    {/if}
    {#each tabEntries as { tabId, component } (tabId)}
      {@const inThisArea = tabIdsInArea.includes(tabId)}
      {@const isThisActive = inThisArea && isActive && activeTabId === tabId}
      {@const View = component}
      {@const manifest = manifestForTab(tabId)}
      <!-- 应用浮层：常驻 DOM 保活（display 切换），激活时覆盖桌面层。 -->
      <div class="app-overlay-layer" class:app-overlay-hidden={!isThisActive}>
        {#if manifest}
          <AppShell app={manifest} pathname={location.pathname}>
            <View {area} {tabId} isActive={isThisActive} />
          </AppShell>
        {:else}
          <View {area} {tabId} isActive={isThisActive} />
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  /* main 区根：桌面底层 + 应用浮层的堆叠上下文。
   * 桌面与应用都常驻 DOM（保活），靠 display + z-index 决定显隐层级。 */
  .main-area-root {
    position: relative;
    height: 100%;
    isolation: isolate;
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
  }
  /* 应用浮层：常驻 DOM 保活（visibility/opacity 过渡而非 display:none/销毁），
   * 保留组件状态/滚动/编辑器/终端会话。激活时显示并覆盖桌面。 */
  .app-overlay-layer {
    position: absolute;
    inset: 0;
    z-index: 10;
    background: var(--background);
    overflow: auto;
    visibility: visible;
    opacity: 1;
    transform: translateY(0);
    transition:
      opacity 0.2s ease,
      transform 0.2s ease,
      visibility 0.2s ease;
  }
  .app-overlay-hidden {
    visibility: hidden;
    opacity: 0;
    transform: translateY(6px);
    pointer-events: none;
  }
</style>
