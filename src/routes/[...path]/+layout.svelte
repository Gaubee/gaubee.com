<!--
	根布局：挂载 NavController，用独立组件渲染四区骨架。
	桌面（容器宽 >= 768px）：DesktopSidebar 左 + 主体右（main + bottom 堆叠）+ 底部 StatusBar
	移动端：MobileHeader 顶 + main 中 + MobileTabBar 底（bottom 区默认不显示）
	pop 区：PopAreaRouter 浮层（Dialog），任何视口都可用

	响应式由 CSS 容器查询驱动（.app-layout 父容器带 container-name: app），
	DesktopSidebar / MobileHeader / MobileTabBar / StatusBar 通过 display: none/flex 互斥切换。
-->
<script lang="ts">
  import '../../app.css'
  import { onMount } from 'svelte'
  import { appManager } from '$lib/apps/AppManager.svelte'
  // import registry 触发模块加载时的应用注册
  import '$lib/apps/registry'
  // import placeholders 触发模块加载时的 view 注册
  import '$lib/views/placeholders'
  import { initNavController } from '$lib/nav/nav-controller-instance'
  import { navStore } from '$lib/nav/nav.svelte'
  import { gaubeeos } from '$lib/os/services'
  import AreaOutlet from '$lib/components/layout/AreaOutlet.svelte'
  import DesktopSidebar from '$lib/components/layout/DesktopSidebar.svelte'
  import MobileTabBar from '$lib/components/layout/MobileTabBar.svelte'
  import BottomAreaRouter from '$lib/components/layout/BottomAreaRouter.svelte'
  import PopAreaRouter from '$lib/components/layout/PopAreaRouter.svelte'
  import SystemStatusBar from '$lib/components/layout/SystemStatusBar.svelte'
  import { Toaster } from '$lib/components/ui/sonner'
  import { notifySuccess, notifyError } from '$lib/apps/builtin/notifications/service.svelte'
  import { ModeWatcher } from 'mode-watcher'

  let { children } = $props()

  onMount(() => {
    // 1. 从 AppManager 构建 TabRegistry 并初始化 NavController
    const allRoutes = appManager.allRoutes
    const mainRoutes = appManager.mainApps.map(a => a.route)
    const bottomRoutes = appManager.bottomApps.map(a => a.route)
    const popRoutes = appManager.allInstalled
      .filter(a => a.defaultArea === 'pop')
      .map(a => a.route)

    initNavController({
      allTabs: allRoutes,
      defaultMainTabs: mainRoutes,
      defaultBottomTabs: bottomRoutes,
      popRoutes,
    })

    // 2. navStore 订阅 NavController + 刷新快照
    navStore.start()
    navStore.refresh()

    // 3. OAuth 回调处理
    const params = new URLSearchParams(window.location.search)
    const authStatus = params.get('auth')
    const authError = params.get('auth_error')
    if (authStatus === 'success') {
      notifySuccess('登录成功')
      // 通过账户服务刷新登录态（account 是系统应用，此时已注册）
      gaubeeos.getAppService('account')?.refresh()
    } else if (authError) {
      const messages: Record<string, string> = {
        invalid_state: '登录失败：状态校验错误，请重试',
        token_exchange: '登录失败：无法与 GitHub 交换令牌',
        no_token: '登录失败：GitHub 未返回令牌',
      }
      notifyError(messages[authError] ?? `登录失败：${authError}`)
    }
    if (authStatus || authError) {
      params.delete('auth')
      params.delete('auth_error')
      const remaining = params.toString()
      const newUrl =
        window.location.pathname + (remaining ? `?${remaining}` : '') + window.location.hash
      window.history.replaceState(window.history.state, '', newUrl)
    }

    return () => navStore.stop()
  })
</script>

<svelte:head>
  <title>Gaubee 编辑器</title>
</svelte:head>

<!-- @container/app：容器查询上下文 -->
<div class="app-layout" style="container-name: app; container-type: inline-size">
  <!-- 顶部系统状态栏（全宽，最高优先级，高于左侧 Dock） -->
  <SystemStatusBar />

  <!-- 工作区：左侧 Dock + 主体（桌面横排，移动仅主体） -->
  <div class="app-workspace">
    <!-- 桌面侧栏 Dock（移动端 display:none） -->
    <DesktopSidebar />

    <!-- 主体 -->
    <div class="app-body">
      <!-- main + bottom 垂直堆叠 -->
      <div class="flex min-h-0 flex-1 flex-col">
        <main class="main-content">
          <AreaOutlet area="main" />
        </main>
        <!-- bottom 区（桌面展开时显示，移动端默认不显示） -->
        <BottomAreaRouter />
      </div>

      <!-- 移动端底栏 Dock（桌面 display:none） -->
      <MobileTabBar />
    </div>
  </div>
</div>

<!-- pop 区浮层（任何视口） -->
<PopAreaRouter />

<!-- SvelteKit children（+page.svelte 输出空，隐藏不占空间；必须渲染否则路由报错） -->
<div style="display: none">{@render children?.()}</div>

<Toaster />
<ModeWatcher />
