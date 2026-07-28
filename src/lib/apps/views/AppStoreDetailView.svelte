<!--
	AppStoreDetailView：应用市场详情页。
	展示应用的展示元数据（description/longDescription/version/author/homepage）+ 能力清单 + 安装卸载。
	克制原则：只展示有真实数据的字段，不堆砌空壳。
-->
<script lang="ts">
  import { appManager } from '$lib/apps/AppManager.svelte'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { useParams } from '$lib/router'
  import { Button } from '$lib/components/ui/button'
  import * as Card from '$lib/components/ui/card'
  import { Badge } from '$lib/components/ui/badge'
  import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left'
  import ExternalLinkIcon from '@lucide/svelte/icons/external-link'
  import TrashIcon from '@lucide/svelte/icons/trash'
  import DownloadIcon from '@lucide/svelte/icons/download'
  import { notifySuccess, notifyError } from '$lib/apps/builtin/notifications/service.svelte'
  import type { AppManifest } from '$lib/apps/types'

  // appId 来自 app-store.detail 子路由的 params（:appId 段捕获）
  const getParams = useParams<{ appId: string }>()
  const appId = $derived(getParams?.()?.appId ?? '')

  const app = $derived(appManager.findById(appId))
  const isInstalled = $derived(app ? appManager.isInstalled(appId) : false)

  // category 友好标签
  const categoryLabel = $derived(
    app?.category === 'system'
      ? '系统应用'
      : app?.category === 'default'
        ? '默认安装'
        : '可安装',
  )

  // 从 manifest 派生能力清单（不暴露技术细节，只标"有/无"）
  const capabilities = $derived.by(() => {
    if (!app) return []
    const caps: string[] = []
    if (app.services) caps.push('系统服务')
    if (app.widgets) caps.push('桌面小组件')
    if (app.appMenus) caps.push('状态栏菜单')
    if (app.cliCommands?.length) caps.push('终端命令')
    if (app.searchService) caps.push('搜索')
    if (app.settingsSections?.length) caps.push('设置面板')
    return caps
  })

  function goBack() {
    navController.navigateMain('/app/store')
  }

  function handleInstall() {
    if (!app) return
    const ok = appManager.install(appId)
    if (ok) notifySuccess('应用已安装')
    else notifyError('安装失败')
  }

  function handleUninstall() {
    if (!app) return
    const ok = appManager.uninstall(appId)
    if (ok) notifySuccess('应用已卸载')
    else notifyError('卸载失败')
  }
</script>

<div class="mx-auto max-w-2xl p-6">
  <!-- 返回 -->
  <button
    class="text-muted-foreground hover:text-foreground mb-4 flex items-center gap-1 text-sm transition-colors"
    onclick={goBack}
  >
    <ArrowLeftIcon class="size-4" />
    返回应用市场
  </button>

  {#if !app}
    <p class="text-muted-foreground text-sm">应用不存在</p>
  {:else}
    <!-- 应用头部 -->
    <div class="mb-6 flex items-start gap-4">
      <div class="bg-card flex size-16 shrink-0 items-center justify-center rounded-2xl border">
        <!-- svelte-ignore ownership_invalid_mutation -->
        <app.icon class="size-8" />
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <h1 class="text-2xl font-bold">{app.name}</h1>
          {#if app.version}
            <span class="text-muted-foreground text-sm">v{app.version}</span>
          {/if}
        </div>
        {#if app.description}
          <p class="text-muted-foreground mt-1 text-sm">{app.description}</p>
        {/if}
        <div class="mt-2 flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{categoryLabel}</Badge>
          {#if app.author}
            <span class="text-muted-foreground text-xs">{app.author}</span>
          {/if}
        </div>
      </div>
    </div>

    <!-- 操作按钮 -->
    <div class="mb-6">
      {#if app.category === 'system'}
        <Button variant="outline" disabled>系统应用，不可卸载</Button>
      {:else if isInstalled}
        <Button variant="outline" onclick={handleUninstall} class="text-destructive hover:text-destructive">
          <TrashIcon class="size-4" />
          卸载
        </Button>
      {:else}
        <Button onclick={handleInstall}>
          <DownloadIcon class="size-4" />
          安装
        </Button>
      {/if}
    </div>

    <!-- 长描述 -->
    {#if app.longDescription}
      <Card.Root class="mb-4">
        <Card.Content class="pt-5">
          <p class="text-sm leading-relaxed">{app.longDescription}</p>
        </Card.Content>
      </Card.Root>
    {/if}

    <!-- 能力清单 -->
    {#if capabilities.length > 0}
      <Card.Root class="mb-4">
        <Card.Header>
          <Card.Title class="text-base">提供的能力</Card.Title>
        </Card.Header>
        <Card.Content>
          <div class="flex flex-wrap gap-2">
            {#each capabilities as cap (cap)}
              <Badge variant="secondary">{cap}</Badge>
            {/each}
          </div>
        </Card.Content>
      </Card.Root>
    {/if}

    <!-- 主页链接 -->
    {#if app.homepage}
      <a
        href={app.homepage}
        target="_blank"
        rel="noopener noreferrer"
        class="text-primary hover:underline flex items-center gap-1 text-sm"
      >
        <ExternalLinkIcon class="size-3.5" />
        {app.homepage}
      </a>
    {/if}
  {/if}
</div>
