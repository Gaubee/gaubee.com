<!--
	SettingsView：设置页 + 应用管理。

	解耦设计：
	- 不再硬编码「账户」等具体功能面板。功能面板通过 settingsSectionsRegistry 注册，
	  SettingsView 遍历 registry.all() 动态渲染入口（点击跳转深链接，或内联 render 组件）。
	  谁提供能力谁注册入口，设置应用不反向依赖具体业务应用。
	- SettingsApp 自身职责：已安装应用管理（安装/卸载）保留为静态卡片。
-->
<script lang="ts">
  import { appManager } from '$lib/apps/AppManager.svelte'
  import { getEntryRoute } from '$lib/apps/types'
  import { settingsSectionsRegistry, type SettingsSection } from '$lib/apps/builtin/settings-sections'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { Button } from '$lib/components/ui/button'
  import * as Card from '$lib/components/ui/card'
  import { Badge } from '$lib/components/ui/badge'
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right'
  import DownloadIcon from '@lucide/svelte/icons/download'
  import TrashIcon from '@lucide/svelte/icons/trash'
  import { notifySuccess, notifyError } from '$lib/apps/builtin/notifications/service.svelte'

  // 已注册的设置面板入口（账户、关于等由各应用自行注册）
  const sections = $derived(settingsSectionsRegistry.all())

  // 应用管理
  const installedApps = $derived(appManager.allInstalled)
  const availableApps = $derived(appManager.available)

  function handleSectionClick(section: SettingsSection) {
    if (section.link) {
      navController.navigateMain(section.link)
    }
  }

  function handleInstall(appId: string) {
    const ok = appManager.install(appId)
    if (ok) {
      notifySuccess(`应用已安装`)
    } else {
      notifyError('安装失败')
    }
  }

  function handleUninstall(appId: string) {
    const ok = appManager.uninstall(appId)
    if (ok) {
      notifySuccess('应用已卸载')
    } else {
      notifyError('卸载失败')
    }
  }
</script>

<div class="mx-auto max-w-2xl p-6">
  <h1 class="mb-6 text-2xl font-semibold">设置</h1>

  <!-- 已注册的设置面板入口（账户、关于等） -->
  {#if sections.length > 0}
    <Card.Root>
      <Card.Content class="flex flex-col gap-1 pt-2">
        {#each sections as section (section.id)}
          {#if section.render}
            <!-- 内联渲染型面板 -->
            <div class="border-b border-border py-3 last:border-b-0">
              <div class="mb-2 flex items-center gap-2">
                {#if section.icon}
                  <!-- svelte-ignore ownership_invalid_mutation -->
                  <section.icon class="text-muted-foreground size-4" />
                {/if}
                <span class="font-medium text-sm">{section.title}</span>
              </div>
              {#if section.description}
                <p class="text-muted-foreground mb-2 text-xs">{section.description}</p>
              {/if}
              <section.render />
            </div>
          {:else}
            <!-- 跳转型入口 -->
            <button
              class="hover:bg-accent flex items-center gap-3 rounded-md px-2 py-3 text-left transition-colors"
              onclick={() => handleSectionClick(section)}
            >
              {#if section.icon}
                <!-- svelte-ignore ownership_invalid_mutation -->
                <section.icon class="text-muted-foreground size-4" />
              {/if}
              <div class="min-w-0 flex-1">
                <div class="font-medium text-sm">{section.title}</div>
                {#if section.description}
                  <div class="text-muted-foreground truncate text-xs">{section.description}</div>
                {/if}
              </div>
              <ChevronRightIcon class="text-muted-foreground size-4" />
            </button>
          {/if}
        {/each}
      </Card.Content>
    </Card.Root>
  {/if}

  <!-- 已安装应用 -->
  <Card.Root class="mt-4">
    <Card.Header>
      <Card.Title>已安装应用</Card.Title>
      <Card.Description>管理当前已安装的应用。</Card.Description>
    </Card.Header>
    <Card.Content>
      {#if installedApps.length === 0}
        <p class="text-muted-foreground text-sm">暂无已安装应用</p>
      {:else}
        <div class="flex flex-col gap-2">
          {#each installedApps as app (app.id)}
            <div class="flex items-center gap-3 rounded-md border p-3">
              <!-- svelte-ignore ownership_invalid_mutation -->
              <app.icon class="text-muted-foreground size-5" />
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="font-medium text-sm">{app.name}</span>
                  {#if app.builtin}
                    <Badge variant="secondary" class="text-xs">系统</Badge>
                  {/if}
                </div>
                <div class="text-muted-foreground text-xs">{getEntryRoute(app)}</div>
              </div>
              {#if !app.builtin}
                <Button
                  variant="ghost"
                  size="sm"
                  onclick={() => handleUninstall(app.id)}
                  class="text-destructive hover:text-destructive"
                >
                  <TrashIcon class="size-4" />
                </Button>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </Card.Content>
  </Card.Root>

  <!-- 应用商店（可安装应用） -->
  {#if availableApps.length > 0}
    <Card.Root class="mt-4">
      <Card.Header>
        <Card.Title>应用商店</Card.Title>
        <Card.Description>安装更多应用以扩展功能。</Card.Description>
      </Card.Header>
      <Card.Content>
        <div class="flex flex-col gap-2">
          {#each availableApps as app (app.id)}
            <div class="flex items-center gap-3 rounded-md border p-3">
              <!-- svelte-ignore ownership_invalid_mutation -->
              <app.icon class="text-muted-foreground size-5" />
              <div class="flex-1 min-w-0">
                <span class="font-medium text-sm">{app.name}</span>
                <div class="text-muted-foreground text-xs">{getEntryRoute(app)}</div>
              </div>
              <Button variant="outline" size="sm" onclick={() => handleInstall(app.id)}>
                <DownloadIcon class="size-4" />
                安装
              </Button>
            </div>
          {/each}
        </div>
      </Card.Content>
    </Card.Root>
  {/if}
</div>
