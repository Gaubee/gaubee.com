<!--
	正交意图：
	1. 原始需求（2026-07-21）：GaubeeOS 的移动抽屉必须列出已安装的应用。
	2. 由 AppManager 投影主区与底栏应用，不依赖已废弃的静态 nav-items。
	3. 点击应用后保持当前主区/底栏激活语义，并关闭 Sheet。
-->
<script lang="ts">
  import { appManager } from '$lib/apps/AppManager.svelte'
  import { routeDomainRegistry } from '$lib/apps/route-domain'
  import { navStore } from '$lib/nav/nav.svelte'
  import { navController } from '$lib/nav/nav-controller-instance'
  import Separator from '$lib/components/ui/separator/separator.svelte'

  let { onnavigate }: { onnavigate?: () => void } = $props()

  const navState = $derived(navStore.current)
  const mainApps = $derived(appManager.mainApps)
  const bottomApps = $derived(appManager.bottomApps)
  // 当前激活的 main/bottom 应用 entry route（查路由域，识别子场景）
  const activeMainRoute = $derived(routeDomainRegistry.entryRouteForPath(navState.mainLocation.pathname))
  const activeBottomRoute = $derived(routeDomainRegistry.entryRouteForPath(navState.bottomLocation.pathname))

  function goMain(route: string): void {
    navController.focusApp(route)
    onnavigate?.()
  }
  function toggleBottom(route: string, isActive: boolean): void {
    if (isActive) {
      navController.deactivateBottom()
    } else {
      navController.activateBottom(route)
    }
    onnavigate?.()
  }
</script>

<nav class="flex flex-col gap-1">
  <div class="text-muted-foreground px-3 py-1 text-[10px] tracking-wider uppercase">主区</div>
  {#each mainApps as app (app.id)}
    {@const isActive = app.route === activeMainRoute}
    <button
      class="hover:bg-accent flex items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-col {isActive
        ? 'bg-accent text-accent-foreground font-medium'
        : ''}"
      onclick={() => goMain(app.route)}
    >
      <app.icon class="size-5 shrink-0" />
      <span>{app.name}</span>
    </button>
  {/each}

  <Separator class="my-2" />

  <div class="text-muted-foreground px-3 py-1 text-[10px] tracking-wider uppercase">底栏</div>
  {#each bottomApps as app (app.id)}
    {@const isActive = navState.bottomActive && app.route === activeBottomRoute}
    <button
      class="hover:bg-accent flex items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition-colors {isActive
        ? 'bg-accent text-accent-foreground font-medium'
        : ''}"
      onclick={() => toggleBottom(app.route, isActive)}
    >
      <app.icon class="size-5 shrink-0" />
      <span>{app.name}</span>
      {#if isActive}
        <span class="text-muted-foreground ml-auto text-xs">已展开</span>
      {/if}
    </button>
  {/each}
</nav>
