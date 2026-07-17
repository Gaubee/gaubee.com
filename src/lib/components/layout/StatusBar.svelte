<!--
	StatusBar：桌面端底部状态栏。
	显示登录态占位（阶段 3 接真实 session）、当前 main 路径、底部 Git 状态占位。
-->
<script lang="ts">
  import { navStore } from '$lib/nav/nav.svelte'
  import { getNavItem } from '$lib/nav/nav-items'
  import { pathToTabIdSafe } from '$lib/nav/path-utils'
  import UserIcon from '@lucide/svelte/icons/user'
  import CircleIcon from '@lucide/svelte/icons/circle'

  const navState = $derived(navStore.current)
  const activeMain = $derived(pathToTabIdSafe(navState.mainLocation.pathname, navState.mainTabs))
  const mainLabel = $derived((activeMain && getNavItem(activeMain)?.label) ?? '未知')
</script>

<footer
  class="desktop-status items-center gap-3 border-t border-border bg-background px-3 py-1 text-muted-foreground text-xs"
  style="display: flex"
>
  <!-- 登录态占位（阶段 3 接 GitHub OAuth） -->
  <span class="flex items-center gap-1">
    <UserIcon class="size-3.5" />
    <span>未登录</span>
  </span>

  <span class="text-border">·</span>

  <!-- 当前视图 -->
  <span class="truncate">{mainLabel} · {navState.mainLocation.pathname}</span>

  <!-- 右侧：bottom 状态 -->
  <span class="ml-auto flex items-center gap-1">
    {#if navState.bottomActive}
      <CircleIcon class="text-primary size-2 fill-current" />
      <span>底栏已展开</span>
    {:else}
      <CircleIcon class="size-2" />
      <span>底栏已收起</span>
    {/if}
  </span>
</footer>
