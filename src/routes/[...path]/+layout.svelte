<!--
	根布局：挂载 NavController，渲染 OS 骨架。
	- SystemStatusBar：顶部全宽系统状态栏（最高优先级）
	- app-workspace：左侧 Dock（DesktopSidebar）+ 主体（main + bottom 堆叠），始终横排，移动/桌面统一
	- SystemFooterBar：底部全宽系统状态栏（ICP 备案号，未来抽屉化，见组件注释）
	- PopAreaRouter：浮层（Dialog），任何视口都可用
-->
<script lang="ts">
  // isomorphic-git 全局 Buffer polyfill（浏览器无原生 Buffer，必须运行时注入）。
  // 放在最前（所有 import 之前），确保 isomorphic-git 的 typeof Buffer 检查通过。
  import { Buffer } from 'buffer'
  if (typeof globalThis.Buffer === 'undefined') {
    ;(globalThis as Record<string, unknown>).Buffer = Buffer
  }

  import '../../app.css'
  import { onMount } from 'svelte'
  import { appManager } from '$lib/apps/AppManager.svelte'
  // import registry 触发模块加载时的应用注册
  import '$lib/apps/registry'
  // import placeholders 触发模块加载时的 view 注册
  import '$lib/views/placeholders'
  import { contentQuery } from '$lib/content-pipeline/query.svelte'
  import { initNavController } from '$lib/nav/nav-controller-instance'
  import { navStore } from '$lib/nav/nav.svelte'
  import { gaubeeos } from '$lib/os/services'
  import AreaOutlet from '$lib/components/layout/AreaOutlet.svelte'
  import DesktopSidebar from '$lib/components/layout/DesktopSidebar.svelte'
  import BottomAreaRouter from '$lib/components/layout/BottomAreaRouter.svelte'
  import PopAreaRouter from '$lib/components/layout/PopAreaRouter.svelte'
  import LaunchpadDialog from '$lib/components/layout/LaunchpadDialog.svelte'
  import DesktopAppSheet from '$lib/apps/views/DesktopAppSheet.svelte'
  import SystemStatusBar from '$lib/components/layout/SystemStatusBar.svelte'
  import SystemFooterBar from '$lib/components/layout/SystemFooterBar.svelte'
  import { Toaster } from '$lib/components/ui/sonner'
  import { notifySuccess, notifyError } from '$lib/apps/builtin/notifications/service.svelte'
  import { ModeWatcher } from 'mode-watcher'
  import { dismissBoot, animateAppIn } from '$lib/boot'
  import { desktopService } from '$lib/apps/builtin/desktop/service.svelte'
  import { backgroundToCss } from '$lib/apps/builtin/desktop/background-render'

  let { children } = $props()

  // 系统背景：桌面背景上移为系统级（覆盖 .app-layout 全屏）。
  // 状态栏/Dock 用 backdrop-blur 透传背景（遵循毛玻璃标准）。
  const systemBackground = $derived(backgroundToCss(desktopService.background))

  onMount(() => {
    // 0. 初始化内容管道（用 readonlyVfs 作为 reader，browser-only）
    //    AppManager.init 已在模块加载时投影 source/processor；此处确保 browser 端执行一次。
    contentQuery.init()

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

    // 4. 启动屏退场 + 主体进场（Web Animations API，并行，同速同时长）
    //    根 layout 也会调用 dismissBoot，但 SPA layout 先执行（内层先于外层 onMount），动画只跑一次（dismissBoot 内部判空）。
    animateAppIn()
    dismissBoot()

    return () => navStore.stop()
  })
</script>

<svelte:head>
  <title>GaubeeOS</title>
</svelte:head>

<!-- @container/app：容器查询上下文。系统背景由 desktopService 提供（桌面背景上移为系统级）。 -->
<div
  class="app-layout"
  style="container-name: app; container-type: inline-size; {systemBackground}"
>
  <!-- 顶部系统状态栏（全宽，最高优先级，高于左侧 Dock） -->
  <SystemStatusBar />

  <!-- 工作区：左侧 Dock + 主体（始终横排，移动/桌面统一） -->
  <div class="app-workspace">
    <!-- 左侧 Dock 侧栏（始终显示，移动端默认折叠态） -->
    <DesktopSidebar />

    <!-- 主体
     统一边框：把原状态栏 border-b 与 Dock border-right 合并到这里。
     视觉上 Dock 与主体之间、状态栏与主体之间共用同一条 L 形边线，更和谐。
     边框色用 var(--border) 与原各处一致。
     -->
    <div class="app-body border-border/80 border border-r-0 border-b-0">
      <!-- main + bottom 垂直堆叠 -->
      <div class="flex min-h-0 flex-1 flex-col">
        <main class="main-content">
          <AreaOutlet area="main" />
        </main>
        <!-- bottom 区 -->
        <BottomAreaRouter />
      </div>
    </div>
  </div>

  <!-- 底部系统状态栏（全宽，跨路由常驻，与顶部 SystemStatusBar 对偶） -->
  <SystemFooterBar />
</div>

<!-- pop 区浮层（任何视口） -->
<PopAreaRouter />

<!-- 管理桌面浮层（应用显示/隐藏/排序） -->
<LaunchpadDialog />

<!-- 桌面「全部应用」BottomSheet（图标溢出时入口） -->
<DesktopAppSheet />

<!-- SvelteKit children（+page.svelte 输出空，隐藏不占空间；必须渲染否则路由报错） -->
<div style="display: none">{@render children?.()}</div>

<Toaster />
<ModeWatcher />
