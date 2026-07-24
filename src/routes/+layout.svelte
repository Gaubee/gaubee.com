<!--
	根布局（中性壳）：仅加载全局样式 + 渲染 children。
	不挂载 NavController（那是 SPA 编辑器 [...path] 的事），保证 SSG 阅读站能 SSR。
	favicon / PWA manifest 在此全局声明（SSG + SPA 都生效）。
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import '../app.css'
  import { ModeWatcher } from 'mode-watcher'
  import { registerSw } from '$lib/sw/register'

  let { children } = $props()

  // 注册 service worker（仅 production + browser，dev 不注册避免破坏 HMR）
  // 移除启动屏（SSG 和 SPA 路由都经过根 layout）
  onMount(() => {
    void registerSw()
    const boot = document.getElementById('gaubee-boot')
    if (boot) {
      boot.classList.add('fade-out')
      setTimeout(() => boot.remove(), 320)
    }
  })
</script>

<svelte:head>
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />
  <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png" />
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <meta name="theme-color" content="#ff5a36" />
</svelte:head>

{@render children?.()}

<ModeWatcher />
