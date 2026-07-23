<!--
	DesktopSidebar：桌面端任务栏（左栏）。

	正交意图：
	1. 原始需求（2026-07-23 任务栏模型）：任务栏=打开+固定的应用，默认空。
	2. 顶部固定"桌面入口"（左栏时桌面在顶部）：点击回桌面（location→/）。
	3. main/bottom 区 AreaNav：渲染打开的应用（navState.mainTabs/bottomTabs）。
	4. pop 入口（搜索/通知）：后台服务快捷入口。
-->
<script lang="ts">
  import { navController } from '$lib/nav/nav-controller-instance'
  import { navStore } from '$lib/nav/nav.svelte'
  import { appManager } from '$lib/apps/AppManager.svelte'
  import AreaNav from './AreaNav.svelte'
  import PanelLeftIcon from '@lucide/svelte/icons/panel-left'
  import LayoutGridIcon from '@lucide/svelte/icons/layout-grid'

  const COLLAPSED_KEY = 'gaubee:sidebar-collapsed'

  let collapsed = $state(false)

  if (typeof window !== 'undefined') {
    collapsed = localStorage.getItem(COLLAPSED_KEY) === 'true'
  }

  function toggleCollapsed() {
    collapsed = !collapsed
    if (typeof window !== 'undefined') {
      localStorage.setItem(COLLAPSED_KEY, String(collapsed))
    }
  }

  // 回桌面：location 设为 /，桌面背景层显现
  function goDesktop() {
    navController.navigateMain('/')
  }

  const navState = $derived(navStore.current)
  // 是否在桌面（决定桌面入口高亮）
  const onDesktop = $derived(navState.mainLocation.pathname === '/')
  // pop 区应用（搜索/通知）
  const popApps = $derived(
    appManager.allInstalled.filter((app) => app.defaultArea === 'pop'),
  )
</script>

<aside class="desktop-sidebar p-2" data-collapsed={collapsed}>
  <!-- 顶部桌面入口 + 折叠按钮（左栏时桌面在顶部） -->
  <div class="mb-3 flex items-center {collapsed ? 'justify-center' : 'justify-between'}">
    {#if collapsed}
      <button
        class="hover:bg-accent flex size-8 items-center justify-center rounded-md {onDesktop ? 'bg-accent text-accent-foreground' : ''}"
        onclick={goDesktop}
        aria-label="桌面"
        title="桌面"
      >
        <LayoutGridIcon class="size-4" />
      </button>
    {:else}
      <button
        class="hover:bg-accent flex items-center gap-2 rounded-md px-2 py-1 text-sm font-semibold {onDesktop ? 'bg-accent text-accent-foreground' : ''}"
        onclick={goDesktop}
      >
        <LayoutGridIcon class="size-4" />
        <span>桌面</span>
      </button>
      <button
        class="text-muted-foreground hover:bg-accent hover:text-foreground flex size-7 items-center justify-center rounded-md"
        onclick={toggleCollapsed}
        aria-label="折叠侧栏"
      >
        <PanelLeftIcon class="size-4" />
      </button>
    {/if}
  </div>

  <!-- main 区任务栏：打开 + 固定的应用（默认空） -->
  <div class="flex-1 overflow-y-auto">
    {#if !collapsed && navState.mainTabs.length === 0}
      <div class="text-muted-foreground px-2 py-4 text-center text-xs">
        打开应用后会出现在这里
      </div>
    {/if}
    <AreaNav area="main" {collapsed} />
  </div>

  <!-- bottom 区任务栏 -->
  <div class="mt-2 border-t pt-2">
    {#if !collapsed && navState.bottomTabs.length === 0}
      <div class="text-muted-foreground px-2 py-2 text-center text-xs">
        底栏
      </div>
    {/if}
    <AreaNav area="bottom" {collapsed} />
  </div>

  <!-- pop 入口（后台服务快捷入口） -->
  {#if popApps.length > 0}
    <div class="mt-2 border-t pt-2">
      {#if !collapsed}
        <div class="text-muted-foreground mb-1 px-2 text-[10px] tracking-wider uppercase">服务</div>
      {/if}
      <div class="flex flex-col gap-0.5">
        {#each popApps as app (app.id)}
          <button
            class="hover:bg-accent flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground"
            onclick={() => navController.activatePop(app.route)}
            aria-haspopup="dialog"
            title={collapsed ? app.name : undefined}
          >
            <!-- svelte-ignore ownership_invalid_mutation -->
            <app.icon class="size-4 shrink-0" />
            {#if !collapsed}<span class="truncate">{app.name}</span>{/if}
          </button>
        {/each}
      </div>
    </div>
  {/if}
</aside>
