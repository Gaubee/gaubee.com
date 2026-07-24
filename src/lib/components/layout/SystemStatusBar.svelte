<!--
	SystemStatusBar：macOS 风格系统顶部状态栏（桌面/移动统一，全宽最高优先级）。

	正交意图：
	1. 原始需求（2026-07-24）：顶部状态栏横跨全宽，高于左侧 Dock；左侧 GaubeeOS logo + 当前场景名。
	2. 三段布局：左 LOGO 系统菜单（苹果菜单）+ 当前场景名（桌面/应用名→应用菜单）/ 右 tray 快捷入口。
	3. appMenus 声明式扩展点消费：appMenuRegistry 按 placement 过滤渲染。

	取代 MobileHeader（移动端顶栏）+ 废除底部 StatusBar（功能上移顶部）。
-->
<script lang="ts">
  import { navStore } from '$lib/nav/nav.svelte'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { appManager } from '$lib/apps/AppManager.svelte'
  import { appMenuRegistry } from '$lib/apps/menu/registry'
  import { routeDomainRegistry } from '$lib/apps/route-domain'
  import type { AppMenuItem } from '$lib/apps/menu/types'
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu'
  import { gaubeeos } from '$lib/os/services'
  import { ACCOUNT_UNAVAILABLE } from '$lib/apps/builtin/account/service'
  import MinusIcon from '@lucide/svelte/icons/minus'
  import XIcon from '@lucide/svelte/icons/x'
  import logoUrl from '$lib/assets/favicon.svg'

  const navState = $derived(navStore.current)
  const account = $derived(gaubeeos.getAppService('account'))
  const accountState = $derived(account?.state ?? ACCOUNT_UNAVAILABLE)

  // 当前激活应用（识别子场景）
  const activeAppRoute = $derived(
    routeDomainRegistry.entryRouteForPath(navState.mainLocation.pathname) ??
      routeDomainRegistry.entryRouteForPath(navState.bottomLocation.pathname),
  )
  const activeAppId = $derived(appManager.findIdByRoute(activeAppRoute ?? ''))
  const activeApp = $derived(activeAppRoute ? appManager.findByRoute(activeAppRoute) : undefined)
  const onDesktop = $derived(navState.mainLocation.pathname === '/')

  // 三类菜单（按 placement 过滤）
  const systemMenus = $derived(appMenuRegistry.forPlacement('system'))
  const appMenus = $derived(appMenuRegistry.forPlacement('app', activeAppId ?? undefined))
  const trayMenus = $derived(appMenuRegistry.forPlacement('tray'))

  // 执行菜单项动作
  function runItem(item: AppMenuItem) {
    if (item.disabled) return
    if (item.onClick) {
      item.onClick()
    } else if (item.link) {
      navController.navigateMain(item.link)
    }
  }

  // 最小化 = 显示桌面（保留应用在任务栏）
  function minimize() {
    navController.navigateMain('/')
  }
  // 退出当前应用（移出任务栏）
  function quitCurrentApp() {
    if (activeAppRoute) navController.quitApp(activeAppRoute)
  }
</script>

<header
  class="system-statusbar sticky top-0 z-[var(--z-shell-base)] flex h-9 shrink-0 items-center gap-1 border-b border-border bg-background/95 px-2 text-xs backdrop-blur supports-[backdrop-filter]:bg-background/80"
>
  <!-- 左：GaubeeOS LOGO 系统菜单（苹果菜单） -->
  {#if systemMenus.length > 0}
    <DropdownMenu.Root>
      <DropdownMenu.Trigger class="flex items-center rounded-md px-1 py-0.5 transition-colors hover:bg-accent">
        <img src={logoUrl} alt="GaubeeOS" class="size-5 shrink-0 rounded-md" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="start">
        {#each systemMenus as menu, mi (menu.id)}
          {#if mi > 0}<DropdownMenu.Separator />{/if}
          {#if menu.items}
            {#each menu.items as item (item.id)}
              {#if item.separator}
                <DropdownMenu.Separator />
              {:else}
                <DropdownMenu.Item
                  onclick={() => runItem(item)}
                  disabled={item.disabled}
                >
                  {#if item.icon}
                    {@const Icon = item.icon}
                    <Icon class="size-4" />
                  {/if}
                  <span>{item.title}</span>
                </DropdownMenu.Item>
              {/if}
            {/each}
          {/if}
        {/each}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  {/if}

  <!-- 当前场景名（桌面态：纯文字；应用态：应用菜单 trigger） -->
  {#if activeApp && !onDesktop}
    <DropdownMenu.Root>
      <DropdownMenu.Trigger class="flex max-w-[12rem] items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold transition-colors hover:bg-accent">
        <span class="truncate">{activeApp.name}</span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="start">
        <!-- 应用自注册菜单项 -->
        {#each appMenus as menu, mi (menu.id)}
          {#if mi > 0}<DropdownMenu.Separator />{/if}
          {#if menu.items}
            {#each menu.items as item (item.id)}
              {#if item.separator}
                <DropdownMenu.Separator />
              {:else}
                <DropdownMenu.Item
                  onclick={() => runItem(item)}
                  disabled={item.disabled}
                >
                  {#if item.icon}
                    {@const Icon = item.icon}
                    <Icon class="size-4" />
                  {/if}
                  <span>{item.title}</span>
                </DropdownMenu.Item>
              {/if}
            {/each}
          {/if}
        {/each}
        {#if appMenus.length > 0}<DropdownMenu.Separator />{/if}
        <!-- 系统标准项：最小化 + 退出 -->
        <DropdownMenu.Item onclick={minimize}>
          <MinusIcon class="size-4" />
          <span>最小化</span>
        </DropdownMenu.Item>
        <DropdownMenu.Item onclick={quitCurrentApp}>
          <XIcon class="size-4" />
          <span>退出{activeApp.name}</span>
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  {:else}
    <span class="px-1 font-semibold">桌面</span>
  {/if}

  <!-- 右：tray 快捷入口 -->
  <div class="ml-auto flex items-center gap-0.5">
    <!-- 登录态指示（已登录显头像） -->
    {#if accountState.loaded && accountState.authenticated && accountState.user}
      <img src={accountState.user.avatar_url} alt="" class="size-5 rounded-full" />
    {/if}

    <!-- tray 菜单（搜索/通知等右上角快捷入口） -->
    {#each trayMenus as menu (menu.id)}
      {@const Icon = menu.icon}
      {#if Icon}
        <button
          class="flex size-7 items-center justify-center rounded-md transition-colors hover:bg-accent"
          onclick={() => menu.onClick?.()}
          aria-label={menu.title}
          title={menu.title}
        >
          <Icon class="size-4" />
        </button>
      {/if}
    {/each}
  </div>
</header>
