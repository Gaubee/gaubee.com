<!--
	AppStoreView：应用市场列表页（已安装 + 可安装）。
	详情页由 app-store.detail 子路由（AppStoreDetailView）独立承载，本组件只渲染列表。
-->
<script lang="ts">
  import { appManager } from '$lib/apps/AppManager.svelte'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { Button } from '$lib/components/ui/button'
  import * as Card from '$lib/components/ui/card'
  import { Badge } from '$lib/components/ui/badge'
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right'

  const installedApps = $derived(appManager.allInstalled)
  const availableApps = $derived(appManager.available)

  function openDetail(appId: string) {
    navController.navigateMain(`/app/store/${appId}`)
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
            <button
              class="hover:bg-accent flex items-center gap-3 rounded-md border p-3 text-left transition-colors"
              onclick={() => openDetail(app.id)}
            >
              <!-- svelte-ignore ownership_invalid_mutation -->
              <app.icon class="text-muted-foreground size-5 shrink-0" />
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-medium">{app.name}</span>
                  {#if app.builtin}
                    <Badge variant="secondary" class="text-xs">系统</Badge>
                  {/if}
                </div>
                <div class="text-muted-foreground truncate text-xs">
                  {app.description ?? app.id}
                </div>
              </div>
              <ChevronRightIcon class="text-muted-foreground size-4 shrink-0" />
            </button>
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
            <button
              class="hover:bg-accent flex items-center gap-3 rounded-md border p-3 text-left transition-colors"
              onclick={() => openDetail(app.id)}
            >
              <!-- svelte-ignore ownership_invalid_mutation -->
              <app.icon class="text-muted-foreground size-5 shrink-0" />
              <div class="min-w-0 flex-1">
                <span class="text-sm font-medium">{app.name}</span>
                <div class="text-muted-foreground truncate text-xs">
                  {app.description ?? app.id}
                </div>
              </div>
              <ChevronRightIcon class="text-muted-foreground size-4 shrink-0" />
            </button>
          {/each}
        </div>
      </Card.Content>
    </Card.Root>
  {/if}
</div>
