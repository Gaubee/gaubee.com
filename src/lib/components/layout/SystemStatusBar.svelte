<!--
	SystemStatusBar：macOS 风格系统顶部状态栏（桌面/移动统一）。

	正交意图：
	1. 原始需求（2026-07-23）：引入顶部状态栏，参考 macOS 把当前应用信息和菜单挂载顶部左上角。
	2. 三段布局：左 LOGO 系统菜单（苹果菜单）/ 中 当前应用主菜单 / 右 tray 快捷入口。
	3. appMenus 声明式扩展点消费：appMenuRegistry 按 placement 过滤渲染。
	4. 容器查询自适应：桌面横排全部菜单；移动紧凑（应用名省略，tray 折叠"更多"）。

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
  import NewspaperIcon from '@lucide/svelte/icons/newspaper'
  import MinusIcon from '@lucide/svelte/icons/minus'
  import XIcon from '@lucide/svelte/icons/x'

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
  class="system-statusbar sticky top-0 z-[var(--z-shell-base)] flex items-center gap-1 border-b border-border bg-background/95 px-2 py-1 text-xs backdrop-blur supports-[backdrop-filter]:bg-background/80"
>
  <!-- 左：LOGO 系统菜单（苹果菜单） -->
  {#if systemMenus.length > 0}
    <DropdownMenu.Root>
      <DropdownMenu.Trigger class="flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors hover:bg-accent">
        <NewspaperIcon class="size-4 shrink-0" />
        <span class="hidden font-semibold sm:inline">Gaubee</span>
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

  <!-- 中：当前应用主菜单 -->
  {#if activeApp && !onDesktop}
    <DropdownMenu.Root>
      <DropdownMenu.Trigger class="flex max-w-[12rem] items-center gap-1 rounded-md px-1.5 py-0.5 font-medium transition-colors hover:bg-accent">
        {#if activeApp.icon}
          <!-- svelte-ignore ownership_invalid_mutation -->
          <activeApp.icon class="size-3.5 shrink-0" />
        {/if}
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
  {:else if onDesktop}
    <span class="px-1.5 font-medium text-muted-foreground">桌面</span>
  {/if}

  <!-- 右：tray 快捷入口 -->
  <div class="ml-auto flex items-center gap-0.5">
    <!-- 登录态指示（已登录显头像，未登录无） -->
    {#if accountState.loaded && accountState.authenticated && accountState.user}
      <img src={accountState.user.avatar_url} alt="" class="size-5 rounded-full" />
    {/if}

    <!-- tray 菜单（桌面直接展开图标，移动折叠到"更多"） -->
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
