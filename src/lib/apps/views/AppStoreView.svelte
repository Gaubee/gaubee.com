<!--
	AppStoreView：应用市场（应用安装/卸载）。
	从设置页抽离的应用管理：已安装应用（可卸载）+ 应用商店（可安装）。
-->
<script lang="ts">
  import { appManager } from '$lib/apps/AppManager.svelte'
  import { getEntryRoute } from '$lib/apps/types'
  import { Button } from '$lib/components/ui/button'
  import * as Card from '$lib/components/ui/card'
  import { Badge } from '$lib/components/ui/badge'
  import DownloadIcon from '@lucide/svelte/icons/download'
  import TrashIcon from '@lucide/svelte/icons/trash'
  import { notifySuccess, notifyError } from '$lib/apps/builtin/notifications/service.svelte'

  const installedApps = $derived(appManager.allInstalled)
  const availableApps = $derived(appManager.available)

  function handleInstall(appId: string) {
    const ok = appManager.install(appId)
    if (ok) {
      notifySuccess('应用已安装')
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
  <h1 class="mb-6 text-2xl font-semibold">应用市场</h1>

  <!-- 已安装应用 -->
  <Card.Root>
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
