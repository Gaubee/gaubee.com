<!--
	AreaOutlet：区域出口组件。
	接收 area prop，渲染该 area 当前激活的 view。
	- main/bottom：所有已注册的 tab view 常驻 DOM，用 CSS display 切换显示（组件保活）。
	  当 activeTabId 为 null（非 tab 路径，如 /article/...）时，渲染深链接 view。
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
</script>

{#if area === 'pop'}
  {#if navState.popActive && popView}
    {@const PopView = popView}
    <PopView />
  {/if}
{:else if area === 'main' && !activeTabId && deepLinkView}
  {@const DeepView = deepLinkView}
  <div class="h-full">
    <DeepView />
  </div>
{:else}
  <div class="h-full">
    {#each tabEntries as { tabId, component } (tabId)}
      {@const inThisArea = tabIdsInArea.includes(tabId)}
      {@const isThisActive = inThisArea && isActive && activeTabId === tabId}
      {@const View = component}
      <div class="h-full" class:hidden={!isThisActive}>
        <View {area} {tabId} isActive={isThisActive} />
      </div>
    {/each}
  </div>
{/if}

<style>
  .hidden {
    display: none;
  }
</style>
