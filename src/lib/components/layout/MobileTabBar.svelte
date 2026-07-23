<!--
	MobileTabBar：移动端底部任务栏。
	中心固定"桌面"按钮（移动端桌面在中心），左右分布打开的应用（mainTabs）。
	应用支持长按上下文菜单（pin/quit）。
	bottom 区在移动端默认不显示（走 MobileHeader）。
-->
<script lang="ts">
  import { navStore } from '$lib/nav/nav.svelte'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { appManager } from '$lib/apps/AppManager.svelte'
  import { pathToTabIdSafe } from '$lib/nav/path-utils'
  import TabContextMenu from './TabContextMenu.svelte'
  import LayoutGridIcon from '@lucide/svelte/icons/layout-grid'
  import type { TabId } from '$lib/nav/controller'

  const navState = $derived(navStore.current)
  const activeTab = $derived(pathToTabIdSafe(navState.mainLocation.pathname, navState.mainTabs))
  const onDesktop = $derived(navState.mainLocation.pathname === '/')
  const isPinned = (tabId: TabId) => navState.pinnedTabs.includes(tabId)

  // 任务栏应用（mainTabs），最多 4 个（左右各 2，中间留桌面）
  const taskbarTabs = $derived(navState.mainTabs.slice(0, 4) as TabId[])
  const leftTabs = $derived(taskbarTabs.slice(0, Math.ceil(taskbarTabs.length / 2)) as TabId[])
  const rightTabs = $derived(taskbarTabs.slice(Math.ceil(taskbarTabs.length / 2)) as TabId[])

  function getAppInfo(route: string) {
    return appManager.findByRoute(route)
  }
  function goDesktop() {
    navController.navigateMain('/')
  }
</script>

<nav
  class="mobile-tabbar sticky bottom-0 z-[var(--z-shell-base)] items-center gap-1 border-t border-border bg-background/95 px-1 pb-[env(safe-area-inset-bottom)] pt-1 backdrop-blur supports-[backdrop-filter]:bg-background/80"
  aria-label="任务栏"
>
  <!-- 左侧应用 -->
  {#each leftTabs as tabId (tabId)}
    {@const app = getAppInfo(tabId)}
    {@const isActive = tabId === activeTab}
    {#if app}
      <TabContextMenu {tabId} pinned={isPinned(tabId)}>
        <button
          class="text-muted-foreground hover:bg-accent flex flex-1 flex-col items-center gap-0.5 rounded-md py-1.5 text-[10px] transition-colors {isActive ? 'text-foreground' : ''}"
          onclick={() => navController.focusApp(tabId)}
          aria-label={app.name}
          aria-current={isActive ? 'page' : undefined}
        >
          <!-- svelte-ignore ownership_invalid_mutation -->
          <app.icon class="size-5" />
          <span class="max-w-[3.5rem] truncate">{app.name}</span>
        </button>
      </TabContextMenu>
    {/if}
  {/each}

  <!-- 中心桌面按钮 -->
  <button
    class="flex flex-1 flex-col items-center gap-0.5 rounded-md py-1.5 text-[10px] transition-colors {onDesktop ? 'text-foreground' : 'text-muted-foreground'}"
    onclick={goDesktop}
    aria-label="桌面"
    aria-current={onDesktop ? 'page' : undefined}
  >
    <LayoutGridIcon class="size-5" />
    <span>桌面</span>
  </button>

  <!-- 右侧应用 -->
  {#each rightTabs as tabId (tabId)}
    {@const app = getAppInfo(tabId)}
    {@const isActive = tabId === activeTab}
    {#if app}
      <TabContextMenu {tabId} pinned={isPinned(tabId)}>
        <button
          class="text-muted-foreground hover:bg-accent flex flex-1 flex-col items-center gap-0.5 rounded-md py-1.5 text-[10px] transition-colors {isActive ? 'text-foreground' : ''}"
          onclick={() => navController.focusApp(tabId)}
          aria-label={app.name}
          aria-current={isActive ? 'page' : undefined}
        >
          <!-- svelte-ignore ownership_invalid_mutation -->
          <app.icon class="size-5" />
          <span class="max-w-[3.5rem] truncate">{app.name}</span>
        </button>
      </TabContextMenu>
    {/if}
  {/each}
</nav>
