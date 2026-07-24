<!--
	BottomAreaRouter：bottom 区容器。
	- 可拖拽 ResizeHandle 调整高度（持久化到 localStorage）
	- 移动端：bottom 区在移动端默认隐藏（空间留给 main），这里只在桌面容器宽度时渲染
	- 折叠按钮：快速收起/展开
-->
<script lang="ts">
  import AreaOutlet from './AreaOutlet.svelte'
  import { navStore } from '$lib/nav/nav.svelte'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { appManager } from '$lib/apps/AppManager.svelte'
  import { pathToTabIdSafe } from '$lib/nav/path-utils'
  import ChevronsDownIcon from '@lucide/svelte/icons/chevrons-down'
  import XIcon from '@lucide/svelte/icons/x'

  const HEIGHT_KEY = 'gaubee:bottom-height'
  const DEFAULT_HEIGHT = 260
  const MIN_HEIGHT = 120
  const MAX_HEIGHT_RATIO = 0.7 // 最大占视口 70%

  const navState = $derived(navStore.current)
  let height = $state(DEFAULT_HEIGHT)
  let resizing = $state(false)

  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem(HEIGHT_KEY)
    if (stored) {
      const n = Number(stored)
      if (!Number.isNaN(n) && n >= MIN_HEIGHT) height = n
    }
  }

  const activeTab = $derived(
    pathToTabIdSafe(navState.bottomLocation.pathname, navState.bottomTabs)
  )
  // 从 AppManager 获取应用名称（不依赖已废弃的静态 nav-items）
  const activeLabel = $derived((activeTab && appManager.findByRoute(activeTab)?.name) ?? '底栏')

  function startResize(e: PointerEvent) {
    e.preventDefault()
    resizing = true
    const startY = e.clientY
    const startHeight = height
    const maxHeight = window.innerHeight * MAX_HEIGHT_RATIO

    const onMove = (ev: PointerEvent) => {
      const delta = startY - ev.clientY // 向上拖增大
      const next = Math.max(MIN_HEIGHT, Math.min(maxHeight, startHeight + delta))
      height = next
    }
    const onUp = () => {
      resizing = false
      localStorage.setItem(HEIGHT_KEY, String(height))
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
</script>

{#if navState.bottomActive}
  <div
    class="bottom-area flex shrink-0 flex-col {resizing ? 'ring-primary/40 ring-1' : ''}"
    style="height: {height}px"
  >
    <!-- 拖拽手柄 + 标题栏。IDE 风格 resize handle：pointerdown 兼容鼠标/触屏/触控笔 -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="hover:bg-accent/50 flex cursor-row-resize items-center gap-2 border-b border-border px-3 py-1.5 select-none"
      style="touch-action: none"
      onpointerdown={startResize}
      role="separator"
      aria-orientation="horizontal"
      aria-label="拖拽调整底栏高度"
    >
      <ChevronsDownIcon class="text-muted-foreground size-3.5" />
      <span class="text-muted-foreground text-xs font-medium">{activeLabel}</span>
      <button
        class="hover:bg-accent ml-auto rounded p-1"
        onclick={(e) => {
          e.stopPropagation()
          navController.deactivateBottom()
        }}
        aria-label="收起底栏"
      >
        <XIcon class="size-3.5" />
      </button>
    </div>

    <!-- bottom 内容 -->
    <div class="bottom-area-content min-h-0 flex-1 overflow-auto">
      <AreaOutlet area="bottom" />
    </div>
  </div>
{/if}
