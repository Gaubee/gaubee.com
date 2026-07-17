<!--
	根布局：挂载 NavController，用独立组件渲染四区骨架。
	- 桌面（容器宽 >= 768px）：DesktopSidebar 左 + 主体右（main + bottom 堆叠）+ 底部 StatusBar
	- 移动端：MobileHeader 顶 + main 中 + MobileTabBar 底（bottom 区默认隐藏）
	- pop 区：PopAreaRouter 浮层（Dialog），任何视口都可用

	响应式由 CSS 容器查询驱动（.app-layout 父容器带 container-name: app），
	DesktopSidebar / MobileHeader / MobileTabBar / StatusBar 通过 display: none/flex 互斥切换。
-->
<script lang="ts">
  import '../app.css'
  import favicon from '$lib/assets/favicon.svg'
  import { onMount } from 'svelte'
  // import placeholders 触发模块加载时的 view 注册
  import '$lib/views/placeholders'
  import { navStore } from '$lib/nav/nav.svelte'
  import AreaOutlet from '$lib/components/layout/AreaOutlet.svelte'
  import DesktopSidebar from '$lib/components/layout/DesktopSidebar.svelte'
  import MobileHeader from '$lib/components/layout/MobileHeader.svelte'
  import MobileTabBar from '$lib/components/layout/MobileTabBar.svelte'
  import BottomAreaRouter from '$lib/components/layout/BottomAreaRouter.svelte'
  import PopAreaRouter from '$lib/components/layout/PopAreaRouter.svelte'
  import StatusBar from '$lib/components/layout/StatusBar.svelte'
  import { Toaster } from '$lib/components/ui/sonner'
  import { ModeWatcher } from 'mode-watcher'

  // navStore 在浏览器侧订阅 navController
  onMount(() => {
    navStore.start()
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

<Toaster />
<ModeWatcher />
