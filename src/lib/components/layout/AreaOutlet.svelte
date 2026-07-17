<!--
	AreaOutlet：区域出口组件。
	接收 area prop，渲染该 area 当前激活的 view。
	- main/bottom：所有已注册的 tab view 常驻 DOM，用 CSS display 切换显示（组件保活）。
	- pop：不常驻，按需渲染（弹层打开时挂载）。
-->
<script lang="ts">
  import { navStore } from '$lib/nav/nav.svelte'
  import { getAllTabViews, activeTabIdForLocation, getPopView } from '$lib/views/registry'
  import type { Area, TabId } from '$lib/nav/controller'
  import type { Component } from 'svelte'

  let { area }: { area: Area } = $props()

  const navState = $derived(navStore.current)

  // 该 area 的 location 与 tab 列表
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

  // 所有已注册的 tab view（常驻渲染）
  const allTabViews = $derived(getAllTabViews())

  // 当前激活的 tab id
  const activeTabId = $derived(activeTabIdForLocation(location, area, tabIdsInArea))

  // pop view（按需）
  const popView = $derived(
    area === 'pop' && navState.popActive ? getPopView(location.pathname) : undefined
  )

  // Svelte 5 runes：动态组件用一个包装组件渲染（避免 <svelte:component> 废弃警告）
  const tabEntries = $derived(allTabViews as ReadonlyArray<{ tabId: TabId; component: Component }>)
</script>

{#if area === 'pop'}
  {#if navState.popActive && popView}
    {@const PopView = popView}
    <PopView />
  {/if}
{:else}
  <!-- main/bottom：常驻所有 tab view，CSS 切换显示 -->
  <div class="h-full">
    {#each tabEntries as { tabId, component } (tabId)}
      {@const inThisArea = tabIdsInArea.includes(tabId)}
      {@const isThisActive = inThisArea && isActive && activeTabId === tabId}
      {@const View = component}
      <div class="h-full" class:hidden={!isThisActive}>
        <View />
      </div>
    {/each}
  </div>
{/if}

<style>
  .hidden {
    display: none;
  }
</style>
