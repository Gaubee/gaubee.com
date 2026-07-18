<!--
	根布局（中性壳）：仅加载全局样式 + 渲染 children。
	不挂载 NavController（那是 SPA 编辑器 [...path] 的事），保证 SSG 阅读站能 SSR。
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import '../app.css'
  import favicon from '$lib/assets/favicon.svg'
  import { ModeWatcher } from 'mode-watcher'
  import { registerSw } from '$lib/sw/register'

  let { children } = $props()

  // 注册 service worker（仅 production + browser，dev 不注册避免破坏 HMR）
  onMount(() => {
    void registerSw()
  })
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
</svelte:head>

{@render children?.()}

<ModeWatcher />
