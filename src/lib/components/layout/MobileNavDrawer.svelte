<!--
	MobileNavDrawer：移动端抽屉内的导航内容。
	在 Sheet 里渲染，列出所有 main + bottom tab，点击导航后关闭抽屉。
-->
<script lang="ts">
  import { navStore } from '$lib/nav/nav.svelte'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { allNavItems, getNavItem } from '$lib/nav/nav-items'
  import { pathToTabIdSafe } from '$lib/nav/path-utils'
  import Separator from '$lib/components/ui/separator/separator.svelte'
  // 注意：separator 是单组件，default 导出为 Separator

  let { onnavigate }: { onnavigate?: () => void } = $props()

  const navState = $derived(navStore.current)
  const activeMainTab = $derived(pathToTabIdSafe(navState.mainLocation.pathname, navState.mainTabs))
  const activeBottomTab = $derived(
    navState.bottomActive ? pathToTabIdSafe(navState.bottomLocation.pathname, navState.bottomTabs) : null
  )

  function goMain(tabId: (typeof navState.mainTabs)[number]) {
    navController.navigateMain(tabId)
    onnavigate?.()
  }
  function toggleBottom(tabId: (typeof navState.bottomTabs)[number], isActive: boolean) {
    if (isActive) navController.deactivateBottom()
    else navController.activateBottom(tabId)
    onnavigate?.()
  }
</script>

<nav class="flex flex-col gap-1">
  <div class="text-muted-foreground px-3 py-1 text-[10px] tracking-wider uppercase">主区</div>
  {#each navState.mainTabs as tabId (tabId)}
    {@const item = getNavItem(tabId)}
    {@const isActive = tabId === activeMainTab}
    {#if item}
      <button
        class="hover:bg-accent flex items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors {isActive
          ? 'bg-accent text-accent-foreground font-medium'
          : ''}"
        onclick={() => goMain(tabId)}
      >
        <item.icon class="size-5 shrink-0" />
        <span>{item.label}</span>
      </button>
    {/if}
  {/each}

  <Separator class="my-2" />

  <div class="text-muted-foreground px-3 py-1 text-[10px] tracking-wider uppercase">底栏</div>
  {#each navState.bottomTabs as tabId (tabId)}
    {@const item = getNavItem(tabId)}
    {@const isActive = tabId === activeBottomTab}
    {#if item}
      <button
        class="hover:bg-accent flex items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors {isActive
          ? 'bg-accent text-accent-foreground font-medium'
          : ''}"
        onclick={() => toggleBottom(tabId, isActive)}
      >
        <item.icon class="size-5 shrink-0" />
        <span>{item.label}</span>
        {#if isActive}
          <span class="text-muted-foreground ml-auto text-xs">已展开</span>
        {/if}
      </button>
    {/if}
  {/each}
</nav>
