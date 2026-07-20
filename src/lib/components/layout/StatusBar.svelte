<!--
	StatusBar：桌面端底部状态栏。
	显示真实登录态（阶段 3 接 GitHub OAuth）、当前 main 路径、bottom 状态。
-->
<script lang="ts">
  import { navStore } from '$lib/nav/nav.svelte'
  import { authStore } from '$lib/auth/session.svelte'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { getNavItem } from '$lib/nav/nav-items'
  import { pathToTabIdSafe } from '$lib/nav/path-utils'
  import { mode, toggleMode } from 'mode-watcher'

  import UserIcon from '@lucide/svelte/icons/user'
  import CircleIcon from '@lucide/svelte/icons/circle'
  import SunIcon from '@lucide/svelte/icons/sun'
  import MoonIcon from '@lucide/svelte/icons/moon'

  const navState = $derived(navStore.current)
  const authState = $derived(authStore.state)
  const activeMain = $derived(pathToTabIdSafe(navState.mainLocation.pathname, navState.mainTabs))
  const mainLabel = $derived((activeMain && getNavItem(activeMain)?.label) ?? '未知')

  function gotoSettings() {
    navController.navigateMain('/settings')
  }
</script>

<footer
  class="desktop-status items-center gap-3 border-t border-border bg-background px-3 py-1 text-muted-foreground text-xs"
>
  <!-- 登录态（点击进设置） -->
  <button
    class="hover:text-foreground flex cursor-pointer items-center gap-1.5 transition-colors"
    onclick={gotoSettings}
  >
    {#if authState.loaded && authState.authenticated && authState.user}
      <img src={authState.user.avatar_url} alt="" class="size-3.5 rounded-full" />
      <span>@{authState.user.login}</span>
    {:else if authState.loaded}
      <UserIcon class="size-3.5" />
      <span>未登录</span>
    {:else}
      <CircleIcon class="size-2 animate-pulse" />
      <span>检查会话…</span>
    {/if}
  </button>

  <span class="text-border">·</span>

  <!-- 当前视图 -->
  <span class="truncate">{mainLabel} · {navState.mainLocation.pathname}</span>

  <!-- 右侧：bottom 状态 + 暗色切换 -->
  <span class="ml-auto flex items-center gap-1">
    {#if navState.bottomActive}
      <CircleIcon class="text-primary size-2 fill-current" />
      <span>底栏已展开</span>
    {:else}
      <CircleIcon class="size-2" />
      <span>底栏已收起</span>
    {/if}
    <span class="text-border mx-1">·</span>
    <button
      class="hover:text-foreground cursor-pointer transition-colors"
      onclick={toggleMode}
      aria-label={mode.current === 'dark' ? '切换到亮色' : '切换到暗色'}
      title={mode.current === 'dark' ? '亮色' : '暗色'}
    >
      {#if mode.current === 'dark'}
        <SunIcon class="size-3.5" />
      {:else}
        <MoonIcon class="size-3.5" />
      {/if}
    </button>
  </span>
</footer>
