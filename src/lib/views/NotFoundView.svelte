<!--
	NotFoundView：系统默认 404 页面（方向二 fallback）。

	当 URL 不匹配任何 tabView/deepLink/popView 且 NotFound 中间件链都放行时渲染。
	显示错误路径 + 双按钮（回到应用首页 / 回到桌面）。
-->
<script lang="ts">
  import { navController } from '$lib/nav/nav-controller-instance'
  import { routeDomainRegistry } from '$lib/apps/route-domain'
  import { appManager } from '$lib/apps/AppManager.svelte'
  import { Button } from '$lib/components/ui/button'

  let { path = '' }: { path?: string } = $props()

  // 推断归属应用的 entry route（若路由域反查命中）
  const entryRoute = $derived(routeDomainRegistry.entryRouteForPath(path))
  const ownerApp = $derived(entryRoute ? appManager.findByRoute(entryRoute) : undefined)
</script>

<div class="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
  <div class="text-muted-foreground/30 select-none text-7xl font-bold">404</div>
  <div class="space-y-1">
    <h1 class="text-xl font-semibold">页面未找到</h1>
    <p class="text-muted-foreground text-sm">
      路径 <code class="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">{path}</code> 不存在或已失效。
    </p>
  </div>
  <div class="flex flex-wrap items-center justify-center gap-2">
    {#if ownerApp}
      <Button variant="default" onclick={() => entryRoute && navController.navigateMain(entryRoute)}>
        回到「{ownerApp.name}」
      </Button>
    {/if}
    <Button variant={ownerApp ? 'outline' : 'default'} onclick={() => navController.navigateMain('/')}>
      回到桌面
    </Button>
  </div>
</div>
