<!--
	MobileHeader：移动端顶栏。
	- 左：汉堡菜单按钮（打开抽屉显示完整导航）
	- 中：当前视图标题（活动 tab 的 label）
	- 右：搜索 + 通知按钮
-->
<script lang="ts">
  import { navStore } from '$lib/nav/nav.svelte'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { appManager } from '$lib/apps/AppManager.svelte'
  import { pathToTabIdSafe } from '$lib/nav/path-utils'
  import MenuIcon from '@lucide/svelte/icons/menu'
  import SearchIcon from '@lucide/svelte/icons/search'
  import BellIcon from '@lucide/svelte/icons/bell'
  import * as Sheet from '$lib/components/ui/sheet'
  import MobileNavDrawer from './MobileNavDrawer.svelte'

  const navState = $derived(navStore.current)

  // 当前 main 活动标题（从 AppManager 获取应用名称，不依赖已废弃的静态 nav-items）
  const activeTitle = $derived.by(() => {
    const tabId = pathToTabIdSafe(navState.mainLocation.pathname, navState.mainTabs)
    if (!tabId) return 'Gaubee'
    return appManager.findByRoute(tabId)?.name ?? 'Gaubee'
  })

  let drawerOpen = $state(false)
</script>

<header
  class="mobile-header sticky top-0 z-30 items-center gap-1 border-b border-border bg-background/95 px-1 py-1 backdrop-blur supports-[backdrop-filter]:bg-background/80"
>
  <button
    class="hover:bg-accent flex size-10 items-center justify-center rounded-md"
    onclick={() => (drawerOpen = true)}
    aria-label="打开菜单"
  >
    <MenuIcon class="size-5" />
  </button>

  <span class="flex-1 truncate text-center font-semibold">{activeTitle}</span>

  <button
    class="hover:bg-accent flex size-10 items-center justify-center rounded-md"
    onclick={() => navController.activatePop('/app/search')}
    aria-label="搜索"
  >
    <SearchIcon class="size-5" />
  </button>
  <button
    class="hover:bg-accent flex size-10 items-center justify-center rounded-md"
    onclick={() => navController.activatePop('/app/notifications')}
    aria-label="通知"
  >
    <BellIcon class="size-5" />
  </button>
</header>

<Sheet.Root bind:open={drawerOpen}>
  <Sheet.Content side="left" class="w-72 p-0">
    <Sheet.Header class="px-4 pt-4">
      <Sheet.Title>导航</Sheet.Title>
    </Sheet.Header>
    <div class="px-2 pb-4">
      <MobileNavDrawer onnavigate={() => (drawerOpen = false)} />
    </div>
  </Sheet.Content>
</Sheet.Root>
