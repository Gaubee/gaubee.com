<!--
	TerminalView：bottom 区的纯前端 bash 终端。
	- xterm.js + TerminalController（readline 循环 + VFS 命令）
	- 移动端输入条（Svelte 实现）：文本框 + 发送 + 常用快捷键，弥补触屏 xterm 输入体验
	- tab 常驻 DOM，变可见时重新 fit 适配宽度

	参考 openspecui xterm-input-panel 的思路（触屏输入面板），用 Svelte 轻量实现，
	避免引入 lit + pixi.js 的重量级依赖。
-->
<script lang="ts">
  import { tick } from 'svelte'
  import { TerminalController } from '$lib/terminal/TerminalController'
  import { mode } from 'mode-watcher'
  import '@xterm/xterm/css/xterm.css'

  /**
   * AreaOutlet 注入的 props：
   * - area：本实例所在的 area（'main' | 'bottom'）。AreaOutlet 会让所有 tab
   *   view 在 main 和 bottom 各渲染一份（非归属的用 display:none 隐藏），
   *   用于跨 area 拖拽时的平滑过渡。对普通 view 无害，但 xterm 状态敏感，
   *   不能重复实例化，故用 area 判断只在自己归属的 area mount。
   * - isActive：本 tab 是否在所在 area 当前激活。
   */
  let {
    area = 'bottom',
    isActive = false,
  }: {
    area?: 'main' | 'bottom'
    isActive?: boolean
  } = $props()

  let container = $state<HTMLDivElement | null>(null)
  let inputBar = $state<HTMLInputElement | null>(null)
  let inputValue = $state('')
  let controller: TerminalController | null = null

  function syncTheme() {
    if (controller && mode.current) {
      controller.setTheme(mode.current === 'dark' ? 'dark' : 'light')
    }
  }

  /**
   * xterm 生命周期：只在"归属本 area + 当前激活"时 mount。
   * - main 区那份 TerminalView（area='main'）永远不会 mount（终端不属于 main）
   * - bottom 区那份在 isActive=true 时 mount 一次，之后保留状态不重复 mount
   */
  const shouldMount = $derived(area === 'bottom' && isActive)

  $effect(() => {
    if (!shouldMount) return
    if (!container || controller) return
    controller = new TerminalController({
      theme: mode.current === 'dark' ? 'dark' : 'light',
    })
    controller.mount(container)
    // 容器刚变可见，等布局完成再 fit
    void tick().then(() => requestAnimationFrame(() => controller?.fit()))
  })

  /** 组件销毁时清理 */
  $effect(() => {
    return () => {
      controller?.unmount()
      controller = null
    }
  })

  // 变激活时重新 fit（容器从 display:none 恢复后尺寸变化）
  $effect(() => {
    if (shouldMount && controller) {
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
      e.preventDefault()
      controller?.sendRaw(e.key === 'ArrowUp' ? '\x1b[A' : '\x1b[B')
    }
  }

  function isTouchDevice(): boolean {
    return typeof window !== 'undefined' && 'ontouchstart' in window
  }
</script>

{#if area === 'bottom'}
  <div class="flex h-full min-h-0 flex-col bg-background">
    <!-- 终端区：relative + overflow-hidden 严格约束 xterm 不溢出覆盖 StatusBar -->
    <div class="relative min-h-0 flex-1 overflow-hidden p-1">
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
{:else}
  <!-- 非 bottom 区（AreaOutlet 跨 area 常驻渲染的副本）：不渲染任何 UI，
       避免 main 区出现无用的终端输入条。xterm 也不会 mount（shouldMount=false）。 -->
  <div class="hidden" aria-hidden="true"></div>
{/if}
