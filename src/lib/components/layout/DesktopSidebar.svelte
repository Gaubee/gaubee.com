<!--
	DesktopSidebar：桌面端侧栏。
	- 顶部 logo / 折叠按钮
	- main 区 AreaNav（功能切换）
	- bottom 区 AreaNav（工具面板）
	- 底部 pop 入口（搜索、通知）
	- 折叠态持久化到 localStorage
-->
<script lang="ts">
  import { navController } from '$lib/nav/nav-controller-instance'
  import { appManager } from '$lib/apps/AppManager.svelte'
  import AreaNav from './AreaNav.svelte'
  import PanelLeftIcon from '@lucide/svelte/icons/panel-left'
  import NewspaperIcon from '@lucide/svelte/icons/newspaper'

  const COLLAPSED_KEY = 'gaubee:sidebar-collapsed'

  let collapsed = $state(false)

  // 从 localStorage 恢复折叠态
  if (typeof window !== 'undefined') {
    collapsed = localStorage.getItem(COLLAPSED_KEY) === 'true'
  }

  function toggleCollapsed() {
    collapsed = !collapsed
    if (typeof window !== 'undefined') {
      localStorage.setItem(COLLAPSED_KEY, String(collapsed))
    }
  }

  // 从 AppManager 获取 pop 区应用（搜索、通知）
  const popApps = $derived(
    appManager.allInstalled.filter((app) => app.defaultArea === 'pop')
  )
</script>

<aside class="desktop-sidebar p-2" data-collapsed={collapsed}>
  <!-- 顶部 logo + 折叠按钮 -->
  <div class="mb-3 flex items-center {collapsed ? 'justify-center' : 'justify-between'}">
    {#if collapsed}
      <button
        class="hover:bg-accent flex size-8 items-center justify-center rounded-md"
        onclick={toggleCollapsed}
        aria-label="展开侧栏"
      >
        <NewspaperIcon class="size-4" />
      </button>
    {:else}
      <div class="flex items-center gap-2 px-1">
        <NewspaperIcon class="size-4" />
        <span class="font-semibold text-sm">Gaubee</span>
      </div>
      <button
        class="text-muted-foreground hover:bg-accent hover:text-foreground flex size-7 items-center justify-center rounded-md"
        onclick={toggleCollapsed}
        aria-label="折叠侧栏"
      >
        <PanelLeftIcon class="size-4" />
      </button>
    {/if}
  </div>

  <!-- main 区 tabs -->
  <div class="flex-1 overflow-y-auto">
    {#if !collapsed}
      <div class="text-muted-foreground mb-1 px-2 text-[10px] tracking-wider uppercase">主区</div>
    {/if}
    <AreaNav area="main" {collapsed} />
  </div>

  <!-- bottom 区 tabs -->
  <div class="mt-2 border-t pt-2">
    {#if !collapsed}
      <div class="text-muted-foreground mb-1 px-2 text-[10px] tracking-wider uppercase">底栏</div>
    {/if}
    <AreaNav area="bottom" {collapsed} />
  </div>

  <!-- pop 入口（从 AppManager 动态获取） -->
  {#if popApps.length > 0}
    <div class="mt-2 border-t pt-2">
      {#if !collapsed}
        <div class="text-muted-foreground mb-1 px-2 text-[10px] tracking-wider uppercase">浮层</div>
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
