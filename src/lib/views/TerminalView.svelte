<!--
	TerminalView：bottom 区的纯前端 bash 终端。
	- xterm.js + TerminalController（readline 循环 + VFS 命令）
	- 移动端输入条（Svelte 实现）：文本框 + 发送 + 常用快捷键，弥补触屏 xterm 输入体验
	- tab 常驻 DOM，变可见时重新 fit 适配宽度

	参考 openspecui xterm-input-panel 的思路（触屏输入面板），用 Svelte 轻量实现，
	避免引入 lit + pixi.js 的重量级依赖。
-->
<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { navStore } from '$lib/nav/nav.svelte'
  import { activeTabIdForLocation } from '$lib/views/registry'
  import { TerminalController } from '$lib/terminal/TerminalController'
  import { mode } from 'mode-watcher'
  import '@xterm/xterm/css/xterm.css'

  let container = $state<HTMLDivElement | null>(null)
  let inputBar = $state<HTMLInputElement | null>(null)
  let inputValue = $state('')
  let controller: TerminalController | null = null
  let mounted = false

  // 判断本 tab 是否当前激活（用于变可见时 fit）
  const navState = $derived(navStore.current)
  const isActive = $derived(
    navState.bottomActive &&
      activeTabIdForLocation(navState.bottomLocation, 'bottom', navState.bottomTabs) === '/terminal',
  )

  function syncTheme() {
    if (controller && mode.current) {
      controller.setTheme(mode.current === 'dark' ? 'dark' : 'light')
    }
  }

  // 当本 tab 变激活时，等 DOM 布局完成后重新 fit（容器从 display:none 恢复尺寸）
  $effect(() => {
    if (mounted && isActive) {
      void tick().then(() => requestAnimationFrame(() => controller?.fit()))
    }
  })

  // 暗色模式变化
  $effect(() => {
    void mode.current
    syncTheme()
  })

  function submit() {
    const text = inputValue
    inputValue = ''
    controller?.submitFromInputBar(text)
    // 提交后焦点回到 xterm（桌面）或保持输入框焦点（移动）
    if (!isTouchDevice()) {
      controller?.focus()
    } else {
      inputBar?.focus()
    }
  }

  function sendCtrlC() {
    controller?.sendRaw('\x03')
  }

  function sendTab() {
    controller?.sendRaw('\t')
  }

  function sendClear() {
    controller?.sendRaw('\x0c')
  }

  function onInputKeydown(e: KeyboardEvent) {
    // 输入框里的快捷键透传到终端
    if (e.key === 'Enter') {
      e.preventDefault()
      submit()
    } else if (e.ctrlKey && e.key === 'c') {
      e.preventDefault()
      sendCtrlC()
    } else if (e.key === 'Tab') {
      e.preventDefault()
      sendTab()
    } else if (e.ctrlKey && e.key === 'l') {
      e.preventDefault()
      sendClear()
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      // 上下方向键透传给终端切历史
      e.preventDefault()
      controller?.sendRaw(e.key === 'ArrowUp' ? '\x1b[A' : '\x1b[B')
    }
  }

  function isTouchDevice(): boolean {
    return typeof window !== 'undefined' && 'ontouchstart' in window
  }

  onMount(() => {
    if (!container) return
    controller = new TerminalController({
      theme: mode.current === 'dark' ? 'dark' : 'light',
    })
    controller.mount(container)
    mounted = true
    // 容器可能初始隐藏，激活后 fit
    void tick().then(() => requestAnimationFrame(() => controller?.fit()))

    return () => {
      controller?.unmount()
      controller = null
      mounted = false
    }
  })
</script>

<div class="flex h-full flex-col bg-background">
  <!-- 终端区 -->
  <div class="relative flex-1 overflow-hidden p-1">
    <div bind:this={container} class="h-full w-full"></div>
  </div>

  <!-- 移动端输入条（始终显示，桌面也可用） -->
  <div class="flex items-center gap-1 border-t border-border bg-background p-1.5">
    <input
      bind:this={inputBar}
      bind:value={inputValue}
      onkeydown={onInputKeydown}
      type="text"
      enterkeyhint="send"
      autocomplete="off"
      autocapitalize="off"
      autocorrect="off"
      spellcheck="false"
      placeholder="输入命令，回车执行…（↑↓ 历史，Tab 补全）"
      class="min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
    />
    <button
      type="button"
      onclick={sendTab}
      title="补全 (Tab)"
      aria-label="补全"
      class="shrink-0 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
    >Tab</button>
    <button
      type="button"
      onclick={sendCtrlC}
      title="中断 (Ctrl+C)"
      aria-label="中断"
      class="shrink-0 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
    >^C</button>
    <button
      type="button"
      onclick={sendClear}
      title="清屏 (Ctrl+L)"
      aria-label="清屏"
      class="shrink-0 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
    >Clr</button>
    <button
      type="button"
      onclick={submit}
      title="发送 (Enter)"
      aria-label="发送"
      class="bg-primary text-primary-foreground shrink-0 rounded-md px-3 py-1 text-xs hover:bg-primary/90"
    >↵</button>
  </div>
</div>
