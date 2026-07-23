<!--
	MobileTabBar：移动端底部快速 tab 切换栏。
	显示主区前 5 个 tab 的图标，点击快速切换。底栏（bottom area）在移动端默认不显示
	（空间有限），用户可通过抽屉打开。
-->
<script lang="ts">
  import { navStore } from '$lib/nav/nav.svelte'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { appManager } from '$lib/apps/AppManager.svelte'
  import { pathToTabIdSafe } from '$lib/nav/path-utils'
  import type { TabId } from '$lib/nav/controller'

  const navState = $derived(navStore.current)
  const activeTab = $derived(pathToTabIdSafe(navState.mainLocation.pathname, navState.mainTabs))

  // 底栏最多 5 个，超出走抽屉
  const quickTabs = $derived(navState.mainTabs.slice(0, 5) as TabId[])

  // 从 AppManager 获取应用元数据（图标/名称），不依赖已废弃的静态 nav-items
  function getAppInfo(route: string) {
    return appManager.findByRoute(route)
  }
</script>

<nav
  class="mobile-tabbar sticky bottom-0 z-[var(--z-shell-base)] items-center gap-1 border-t border-border bg-background/95 px-1 pb-[env(safe-area-inset-bottom)] pt-1 backdrop-blur supports-[backdrop-filter]:bg-background/80"
  aria-label="主导航"
>
  {#each quickTabs as tabId (tabId)}
    {@const app = getAppInfo(tabId)}
    {@const isActive = tabId === activeTab}
    {#if app}
      <button
        class="text-muted-foreground hover:bg-accent flex flex-1 flex-col items-center gap-0.5 rounded-md py-1.5 text-[10px] transition-colors {isActive
          ? 'text-foreground'
          : ''}"
        onclick={() => navController.focusApp(tabId)}
        aria-label={app.name}
        aria-current={isActive ? 'page' : undefined}
      >
        <!-- svelte-ignore ownership_invalid_mutation -->
        <app.icon class="size-5" />
        <span class="truncate">{app.name}</span>
      </button>
    {/if}
  {/each}
</nav>
