<!--
	DesktopAppSheet：桌面「全部应用」BottomSheet。
	桌面图标溢出时，点击「全部」图标打开此面板。

	结构：
	- 上区「桌面应用」：visibleApps 完整网格（所有桌面显示的应用，点击启动）。
	- 下区「所有应用」：allInstalled 按默认排序的列表（点击启动），含未在桌面显示的应用。

	属于 DesktopApp，由 desktopLayout.allAppsOpen 控制。
-->
<script lang="ts">
  import { appManager } from '$lib/apps/AppManager.svelte'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { desktopLayout } from '$lib/apps/desktop-layout.svelte'
  import * as Sheet from '$lib/components/ui/sheet'
  import { Button } from '$lib/components/ui/button'
  import { flip } from 'svelte/animate'
  import GridIcon from '@lucide/svelte/icons/layout-grid'
  import SlidersHorizontalIcon from '@lucide/svelte/icons/sliders-horizontal'

  const visibleApps = $derived(desktopLayout.visibleApps(appManager.allInstalled))
  // 所有已安装应用（排除 desktop 自身），按 registry 默认顺序
  const allApps = $derived(appManager.allInstalled.filter((a) => a.id !== 'desktop'))

  function launch(route: string, area: string) {
    if (area === 'pop') {
      navController.activatePop(route)
    } else if (appManager.isEntryRouteVisible(route)) {
      navController.openApp(route)
    } else {
      navController.navigateMain(route)
    }
    desktopLayout.closeAllApps()
  }

  // 从 BottomSheet 跳转到「管理桌面」Dialog：先关 BottomSheet 再开 Dialog
  function openLaunchpad() {
    desktopLayout.closeAllApps()
    desktopLayout.openLaunchpad()
  }
</script>

<Sheet.Root
  open={desktopLayout.allAppsOpen}
  onOpenChange={(v) => { if (!v) desktopLayout.closeAllApps() }}
>
  <Sheet.Content side="bottom" class="max-h-[80dvh] rounded-t-lg p-0" showCloseButton={false}>
    <Sheet.Header class="flex-row items-center justify-between border-b px-4 py-3">
      <Sheet.Title class="flex items-center gap-2">
        <GridIcon class="size-4" />
        全部应用
      </Sheet.Title>
      <Sheet.Description class="sr-only">查看桌面应用与所有已安装应用</Sheet.Description>
      <Button variant="ghost" size="sm" onclick={openLaunchpad} class="gap-1.5">
        <SlidersHorizontalIcon class="size-4" />
        管理
      </Button>
    </Sheet.Header>

    <div class="max-h-[calc(80dvh-4rem)] space-y-4 overflow-y-auto p-4">
      <!-- 上区：桌面应用完整网格 -->
      {#if visibleApps.length > 0}
        <section>
          <h3 class="text-muted-foreground mb-2 text-xs font-medium">桌面应用（{visibleApps.length}）</h3>
          <div class="grid grid-cols-[repeat(auto-fill,minmax(5rem,1fr))] gap-2">
            {#each visibleApps as app (app.id)}
              <button
                class="hover:bg-accent flex flex-col items-center gap-1 rounded-lg border p-2 transition-colors"
                onclick={() => launch(app.route, app.defaultArea)}
                animate:flip={{ duration: 200 }}
              >
                <!-- svelte-ignore ownership_invalid_mutation -->
                <app.icon class="size-6" />
                <span class="w-full truncate text-center text-xs">{app.name}</span>
              </button>
            {/each}
          </div>
        </section>
      {/if}

      <!-- 下区：所有已安装应用列表 -->
      <section>
        <h3 class="text-muted-foreground mb-2 text-xs font-medium">所有应用（{allApps.length}）</h3>
        <div class="flex flex-col">
          {#each allApps as app (app.id)}
            <button
              class="hover:bg-accent flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors"
              onclick={() => launch(app.route, app.defaultArea)}
            >
              <!-- svelte-ignore ownership_invalid_mutation -->
              <app.icon class="size-5 text-muted-foreground" />
              <span class="flex-1 font-medium">{app.name}</span>
              <span class="text-muted-foreground text-xs">{app.description}</span>
            </button>
          {/each}
        </div>
      </section>
    </div>
  </Sheet.Content>
</Sheet.Root>
