<!--
	根布局：挂载 NavController，渲染四区骨架（nav / main / bottom / pop）。
	阶段 1：极简版，侧栏直接渲染 tab 按钮列表；阶段 2 会拆成 DesktopSidebar / AreaNav 等独立组件。
	布局响应式：容器查询，移动端竖排，桌面横排。
-->
<script lang="ts">
  import '../app.css'
  import favicon from '$lib/assets/favicon.svg'
  import { onMount } from 'svelte'
  // import placeholders 触发模块加载时的 view 注册（见 placeholders.ts 末尾）
  import '$lib/views/placeholders'
  import { navStore } from '$lib/nav/nav.svelte'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { allNavItems } from '$lib/nav/nav-items'
  import AreaOutlet from '$lib/components/layout/AreaOutlet.svelte'
  import { Toaster } from '$lib/components/ui/sonner'

  // navStore 在浏览器侧订阅 navController（SSR 时无操作）
  onMount(() => {
    navStore.start()
    return () => navStore.stop()
  })

  const state = $derived(navStore.current)
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
  <title>Gaubee 编辑器</title>
</svelte:head>

<!-- @container/app：容器查询上下文，布局方向由 .app-layout 宽度切换 -->
<div class="app-layout text-foreground" style="container-name: app; container-type: inline-size">
  <!-- 桌面侧栏：阶段 1 极简版，阶段 2 替换为 DesktopSidebar.svelte -->
  <aside class="desktop-sidebar p-3">
    <div class="flex flex-col gap-1">
      <!-- main 区 tabs -->
      <div class="mb-1 px-2 text-muted-foreground text-[10px] tracking-wider uppercase">主区</div>
      {#each state.mainTabs as tabId (tabId)}
        {@const item = allNavItems.find((i) => i.to === tabId)}
        {#if item}
          {@const isActive = state.mainLocation.pathname === tabId || state.mainLocation.pathname.startsWith(tabId + '/')}
          <button
            class="hover:bg-accent flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors {isActive
              ? 'bg-accent text-accent-foreground font-medium'
              : ''}"
            onclick={() => navController.navigateMain(tabId)}
          >
            <item.icon class="size-4 shrink-0" />
            <span class="truncate">{item.label}</span>
          </button>
        {/if}
      {/each}

      <!-- bottom 区 tabs -->
      <div class="mt-3 mb-1 px-2 text-muted-foreground text-[10px] tracking-wider uppercase">
        底栏
      </div>
      {#each state.bottomTabs as tabId (tabId)}
        {@const item = allNavItems.find((i) => i.to === tabId)}
        {#if item}
          {@const isActive =
            state.bottomLocation.pathname === tabId ||
            state.bottomLocation.pathname.startsWith(tabId + '/')}
          <button
            class="hover:bg-accent flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors {isActive
              ? 'bg-accent text-accent-foreground font-medium'
              : ''}"
            onclick={() =>
              isActive
                ? navController.deactivateBottom()
                : navController.activateBottom(tabId)}
          >
            <item.icon class="size-4 shrink-0" />
            <span class="truncate">{item.label}</span>
          </button>
        {/if}
      {/each}
    </div>

    <!-- 底部：搜索 + 通知（pop 入口） -->
    <div class="mt-auto flex flex-col gap-1 pt-3">
      <button
        class="hover:bg-accent flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm"
        onclick={() => navController.activatePop('/search')}
      >
        <span class="truncate">搜索</span>
      </button>
    </div>
  </aside>

  <!-- 主体：main + bottom 垂直堆叠 -->
  <div class="app-body">
    <!-- 移动端顶栏：阶段 1 极简版，阶段 2 替换为 MobileHeader.svelte -->
    <header
      class="mobile-header items-center gap-2 border-b border-border px-3 py-2"
      style="display: flex"
    >
      <span class="font-semibold">Gaubee</span>
      <div class="ml-auto flex gap-1">
        {#each state.mainTabs.slice(0, 4) as tabId (tabId)}
          {@const item = allNavItems.find((i) => i.to === tabId)}
          {#if item}
            {@const isActive = state.mainLocation.pathname === tabId}
            <button
              class="rounded p-2 {isActive ? 'bg-accent text-accent-foreground' : ''}"
              onclick={() => navController.navigateMain(tabId)}
              aria-label={item.label}
            >
              <item.icon class="size-5" />
            </button>
          {/if}
        {/each}
      </div>
    </header>

    <!-- main 区出口 -->
    <main class="main-content">
      <AreaOutlet area="main" />
    </main>

    <!-- bottom 区：bottomActive 时显示，阶段 2 会加 ResizeHandle -->
    {#if state.bottomActive}
      <div class="bottom-area" style="height: 240px">
        <AreaOutlet area="bottom" />
      </div>
    {/if}
  </div>
</div>

<!-- pop 区：浮层，popActive 时显示 -->
{#if state.popActive}
  <div class="pop-area-overlay bg-background/80 backdrop-blur-sm">
    <div class="bg-background mx-auto mt-16 max-w-2xl rounded-lg border shadow-lg">
      <div class="flex items-center justify-between border-b p-3">
        <span class="font-medium">弹层 · {state.popLocation.pathname}</span>
        <button
          class="hover:bg-accent rounded p-1 text-sm"
          onclick={() => navController.deactivatePop()}
        >
          ✕
        </button>
      </div>
      <div class="max-h-[70vh] overflow-auto p-4">
        <AreaOutlet area="pop" />
      </div>
    </div>
  </div>
{/if}

<Toaster />
