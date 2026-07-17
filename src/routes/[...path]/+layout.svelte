<!--
	根布局：挂载 NavController，用独立组件渲染四区骨架。
	- 桌面（容器宽 >= 768px）：DesktopSidebar 左 + 主体右（main + bottom 堆叠）+ 底部 StatusBar
	- 移动端：MobileHeader 顶 + main 中 + MobileTabBar 底（bottom 区默认隐藏）
	- pop 区：PopAreaRouter 浮层（Dialog），任何视口都可用

	响应式由 CSS 容器查询驱动（.app-layout 父容器带 container-name: app），
	DesktopSidebar / MobileHeader / MobileTabBar / StatusBar 通过 display: none/flex 互斥切换。
-->
<script lang="ts">
  import '../../app.css'
  import favicon from '$lib/assets/favicon.svg'
  import { onMount } from 'svelte'
  // import placeholders 触发模块加载时的 view 注册
  import '$lib/views/placeholders'
  import { navStore } from '$lib/nav/nav.svelte'
  import { authStore } from '$lib/auth/session.svelte'
  import AreaOutlet from '$lib/components/layout/AreaOutlet.svelte'
  import DesktopSidebar from '$lib/components/layout/DesktopSidebar.svelte'
  import MobileHeader from '$lib/components/layout/MobileHeader.svelte'
  import MobileTabBar from '$lib/components/layout/MobileTabBar.svelte'
  import BottomAreaRouter from '$lib/components/layout/BottomAreaRouter.svelte'
  import PopAreaRouter from '$lib/components/layout/PopAreaRouter.svelte'
  import StatusBar from '$lib/components/layout/StatusBar.svelte'
  import { Toaster } from '$lib/components/ui/sonner'
  import { toast } from 'svelte-sonner'
  import { ModeWatcher } from 'mode-watcher'

  // navStore 在浏览器侧订阅 navController；处理 OAuth 回调 query
  let { children } = $props()

  onMount(() => {
    navStore.start()

    // OAuth 回调：Worker 重定向回来时带 ?auth=success 或 ?auth_error=xxx
    const params = new URLSearchParams(window.location.search)
    const authStatus = params.get('auth')
    const authError = params.get('auth_error')
    if (authStatus === 'success') {
      toast.success('登录成功')
      authStore.refresh()
    } else if (authError) {
      const messages: Record<string, string> = {
        invalid_state: '登录失败：状态校验错误，请重试',
        token_exchange: '登录失败：无法与 GitHub 交换令牌',
        no_token: '登录失败：GitHub 未返回令牌',
      }
      toast.error(messages[authError] ?? `登录失败：${authError}`)
    }
    // 清掉 auth query（避免刷新重复 toast）
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
  <link rel="icon" href={favicon} />
  <title>Gaubee 编辑器</title>
</svelte:head>

<!-- @container/app：容器查询上下文 -->
<div class="app-layout" style="container-name: app; container-type: inline-size">
  <!-- 桌面侧栏（移动端 display:none） -->
  <DesktopSidebar />

  <!-- 主体 -->
  <div class="app-body">
    <!-- 移动端顶栏（桌面 display:none） -->
    <MobileHeader />

    <!-- main + bottom 垂直堆叠 -->
    <div class="flex min-h-0 flex-1 flex-col">
      <main class="main-content">
        <AreaOutlet area="main" />
      </main>
      <!-- bottom 区（桌面展开时显示，移动端默认不显示） -->
      <BottomAreaRouter />
    </div>

    <!-- 移动端底栏 tab（桌面 display:none） -->
    <MobileTabBar />
    <!-- 桌面底部状态栏（移动端 display:none） -->
    <StatusBar />
  </div>
</div>

<!-- pop 区浮层（任何视口） -->
<PopAreaRouter />

<!-- SvelteKit children（+page.svelte 输出空，隐藏不占空间；必须渲染否则路由报错） -->
<div style="display: none">{@render children?.()}</div>

<Toaster />
<ModeWatcher />
