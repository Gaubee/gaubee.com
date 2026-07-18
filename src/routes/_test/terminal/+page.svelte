<!--
	终端独立测试页（/test/terminal）。
	全屏终端，不走 NavController，方便 Playwright 验证。
-->
<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { TerminalController } from '$lib/terminal/TerminalController'
  import { mode } from 'mode-watcher'
  import '@xterm/xterm/css/xterm.css'

  let container = $state<HTMLDivElement | null>(null)
  let controller: TerminalController | null = null

  function syncTheme() {
    if (controller && mode.current) {
      controller.setTheme(mode.current === 'dark' ? 'dark' : 'light')
    }
  }

  $effect(() => {
    void mode.current
    syncTheme()
  })

  onMount(() => {
    if (!container) return
    controller = new TerminalController({
      theme: mode.current === 'dark' ? 'dark' : 'light',
    })
    controller.mount(container)
    void tick().then(() => requestAnimationFrame(() => controller?.fit()))
    return () => {
      controller?.unmount()
      controller = null
    }
  })
</script>

<svelte:head>
  <title>终端测试 · Gaubee</title>
</svelte:head>

<div class="bg-background text-foreground flex h-dvh flex-col">
  <div class="flex-1 overflow-hidden p-2">
    <div bind:this={container} class="h-full w-full"></div>
  </div>
</div>
