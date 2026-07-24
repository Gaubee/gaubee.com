<!--
	DesktopView：GaubeeOS 桌面（系统级默认首页）。

	正交意图：
	1. 原始需求（2026-07-23）：引入"桌面"理念，应用浮于桌面之上，桌面是常驻背景层。
	2. 应用图标网格（启动器）：已安装应用入口，点击聚焦应用（应用浮层覆盖桌面）。
	3. Widget 瀑布流：各应用声明的内容小组件（最近文章/说说/标签云），容器查询自适应。

	注意：任务栏（Dock）是 shell 级组件（DesktopSidebar），不在本视图内。
	本视图只负责桌面内容（图标网格 + widget）。桌面作为 main 区背景层常驻，
	应用以浮层覆盖桌面，任务栏始终在 shell 层可见。
-->
<script lang="ts">
  import { appManager } from '$lib/apps/AppManager.svelte'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { navStore } from '$lib/nav/nav.svelte'
  import { widgetRegistry } from '$lib/apps/widget/registry'
  import { routeDomainRegistry } from '$lib/apps/route-domain'
  import { motionFade } from '$lib/utils/motion'
  import { flip } from 'svelte/animate'

  const navState = $derived(navStore.current)
  // 桌面图标网格（启动器）：所有已安装应用，排除 desktop（避免自引用）。
  // 含 hiddenFromNav 的应用（search/notifications/account）——它们在桌面作为快捷入口。
  const launcherApps = $derived(
    appManager.allInstalled.filter((app) => app.id !== 'desktop'),
  )
  const widgets = $derived(widgetRegistry.all())

  // 判断应用是否在任务栏（已打开或 pinned）→ 图标红点标记
  function isOpen(route: string): boolean {
    return (
      navState.mainTabs.includes(route) ||
      navState.bottomTabs.includes(route)
    )
  }
  // 当前激活的应用 entry route（用于高亮图标，识别子场景如 /article/...）
  const activeRoute = $derived(
    routeDomainRegistry.entryRouteForPath(navState.mainLocation.pathname) ??
    routeDomainRegistry.entryRouteForPath(navState.bottomLocation.pathname),
  )

  function launch(route: string, area: string) {
    if (area === 'pop') {
      navController.activatePop(route)
    } else {
      // main/bottom 应用：openApp（加入任务栏 + 聚焦）
      navController.openApp(route)
    }
  }
</script>

<div class="desktop-scroll-area scrollbar-thin scrollbar-track-transparent scrollbar-thumb-[color-mix(in_srgb,currentColor,transparent)]">
  <div class="desktop-container">
    <!-- 应用图标网格（启动器）：无分组标题，图标自由组合 -->
    <div class="app-grid">
      {#each launcherApps as app, i (app.id)}
        {@const active = app.route === activeRoute}
        <button
          class="app-icon-button {active ? 'app-icon-active' : ''}"
          onclick={() => launch(app.route, app.defaultArea)}
          aria-label={app.name}
          in:motionFade={{ delay: i * 30, duration: 200 }}
          animate:flip={{ duration: 200 }}
        >
          <span class="app-icon-box">
            <!-- svelte-ignore ownership_invalid_mutation -->
            <app.icon class="size-6" />
            {#if isOpen(app.route) && !active}
              <span class="app-icon-dot"></span>
            {/if}
          </span>
          <span class="app-icon-label">{app.name}</span>
        </button>
      {/each}
    </div>

    <!-- Widget 瀑布流：无分组标题，卡片自由组合 -->
    {#if widgets.length > 0}
      <div class="widget-grid">
        {#each widgets as widget (widget.id)}
          {@const Widget = widget.render}
          <article
            class="widget-card widget-size-{widget.size ?? 'small'}"
            in:motionFade={{ duration: 240 }}
            animate:flip={{ duration: 200 }}
          >
            <header class="widget-header">
              <h3 class="widget-title">{widget.title}</h3>
            </header>
            <div class="widget-body">
              <Widget />
            </div>
          </article>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .desktop-scroll-area {
    height: 100%;
    overflow-y: auto;
  }
  .desktop-container {
    max-width: 80rem;
    margin: 0 auto;
    padding: 1.5rem 1rem 5rem;
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  /* 应用图标网格：容器查询自适应列数 */
  .app-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(5rem, 1fr));
    gap: 0.75rem;
  }
  .app-icon-button {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.375rem;
    padding: 0.75rem 0.5rem;
    border-radius: 1rem;
    transition: background 0.15s;
    cursor: pointer;
  }
  .app-icon-button:hover {
    background: var(--accent);
  }
  .app-icon-box {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 3.5rem;
    height: 3.5rem;
    border-radius: 1.25rem;
    background: var(--card);
    border: 1px solid var(--border);
    color: var(--foreground);
  }
  .app-icon-active .app-icon-box {
    background: var(--primary);
    color: var(--primary-foreground);
    border-color: transparent;
  }
  .app-icon-dot {
    position: absolute;
    bottom: -0.125rem;
    right: -0.125rem;
    width: 0.625rem;
    height: 0.625rem;
    border-radius: 9999px;
    background: var(--primary);
    border: 2px solid var(--background);
  }
  .app-icon-label {
    font-size: 0.75rem;
    color: var(--foreground);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Widget 瀑布流：容器查询自适应列数 */
  .widget-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
    gap: 1rem;
    align-items: start;
  }
  .widget-card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 1.25rem;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  /* 尺寸档位：wide 跨整行 */
  .widget-size-wide {
    grid-column: 1 / -1;
  }
  .widget-size-medium {
    grid-column: span 2;
  }
  @container app (max-width: 480px) {
    .widget-size-medium,
    .widget-size-wide {
      grid-column: 1 / -1;
    }
  }
  .widget-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .widget-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--muted-foreground);
  }
  .widget-body {
    min-height: 4rem;
  }
</style>
