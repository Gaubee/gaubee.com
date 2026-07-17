<!--
	AreaNav：某 area 的 tab 列表组件。
	- main area：点击 tab 走 navigateMain（router push）。
	- bottom area：点击 tab 是 toggle（activate/deactivate）。
	- HTML5 拖拽：跨 area moveTab + 同 area reorder，带落点指示线。
	- 关闭按钮：hover 显示（阶段 1 的 nav 简化版无此功能，这里补上）。
-->
<script lang="ts">
  import { navStore } from '$lib/nav/nav.svelte'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { draggedTabId, setDraggedTab } from '$lib/nav/drag-state.svelte'
  import { getNavItem } from '$lib/nav/nav-items'
  import type { Area, TabId } from '$lib/nav/controller'
  import XIcon from '@lucide/svelte/icons/x'

  let {
    area,
    collapsed = false,
  }: {
    area: 'main' | 'bottom'
    collapsed?: boolean
  } = $props()

  const navState = $derived(navStore.current)
  const tabs = $derived(area === 'main' ? navState.mainTabs : navState.bottomTabs)

  // 当前激活的 tab id
  const activeTabId = $derived.by(() => {
    const loc = area === 'main' ? navState.mainLocation : navState.bottomLocation
    for (const tabId of tabs) {
      if (loc.pathname === tabId || loc.pathname.startsWith(tabId + '/')) {
        return tabId
      }
    }
    return null
  })

  // 落点指示：{ index, position: 'before' | 'after' }，用 state + ref（drop 时 state 可能滞后）
  let dropIndicator = $state<{ index: number; position: 'before' | 'after' } | null>(null)
  let dropIndicatorRef: { index: number; position: 'before' | 'after' } | null = null
  let dragOverArea = $state(false)

  function updateIndicator(value: { index: number; position: 'before' | 'after' } | null) {
    dropIndicatorRef = value
    dropIndicator = value
  }

  function handleDragStart(e: DragEvent, tabId: TabId) {
    if (!e.dataTransfer) return
    setDraggedTab(tabId)
    e.dataTransfer.setData('text/plain', tabId)
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDragEnd() {
    setDraggedTab(null)
    updateIndicator(null)
    dragOverArea = false
  }

  function handleItemDragOver(e: DragEvent, index: number) {
    if (!draggedTabId) return
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'

    if (tabs[index] === draggedTabId) {
      updateIndicator(null)
      return
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const midY = rect.top + rect.height / 2
    updateIndicator({
      index,
      position: e.clientY < midY ? 'before' : 'after',
    })
    dragOverArea = true
  }

  function handleAreaDragOver(e: DragEvent) {
    if (!draggedTabId) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  }

  function handleAreaDragLeave(e: DragEvent) {
    // 只有真正离开 area（relatedTarget 不在内部）才清空
    const rt = e.relatedTarget as Node | null
    if (rt && (e.currentTarget as HTMLElement).contains(rt)) return
    dragOverArea = false
    updateIndicator(null)
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    const tabId = (e.dataTransfer?.getData('text/plain') ?? draggedTabId) as TabId | null
    const indicator = dropIndicatorRef
    dragOverArea = false
    updateIndicator(null)
    setDraggedTab(null)
    if (!tabId) return

    const isFromThisArea = tabs.includes(tabId)
    const currentTabs = area === 'main' ? [...navController.mainTabs] : [...navController.bottomTabs]

    // 跨 area：先 moveTab
    if (!isFromThisArea) {
      navController.moveTab(tabId, area)
    }

    // 精细 reorder 到 indicator 位置
    if (indicator) {
      const refreshedTabs =
        area === 'main' ? [...navController.mainTabs] : [...navController.bottomTabs]
      const remaining = refreshedTabs.filter((t) => t !== tabId)
      const targetTab = refreshedTabs[indicator.index]
      if (targetTab && targetTab !== tabId) {
        const targetIndex = remaining.indexOf(targetTab)
        if (targetIndex >= 0) {
          const insertIndex = indicator.position === 'before' ? targetIndex : targetIndex + 1
          remaining.splice(insertIndex, 0, tabId)
          navController.reorder(area, remaining)
        }
      } else if (!isFromThisArea) {
        // 跨 area 拖入但 indicator 指向末尾或无效位置，reorder 到末尾
        navController.reorder(area, remaining.length > 0 ? [...remaining, tabId] : refreshedTabs)
      }
    }
  }

  function handleClick(tabId: TabId, isActive: boolean) {
    if (area === 'main') {
      navController.navigateMain(tabId)
    } else {
      // bottom：toggle
      if (isActive) navController.deactivateBottom()
      else navController.activateBottom(tabId)
    }
  }

  function handleClose(e: MouseEvent, tabId: TabId) {
    e.stopPropagation()
    navController.closeTab(tabId)
  }
</script>

<ul
  class="min-h-8 flex flex-col gap-0.5 {dragOverArea ? 'bg-accent/40 rounded-md' : ''}"
  role="tablist"
  ondragover={handleAreaDragOver}
  ondragleave={handleAreaDragLeave}
  ondrop={handleDrop}
>
  {#each tabs as tabId, index (tabId)}
    {@const item = getNavItem(tabId)}
    {@const isActive = tabId === activeTabId}
    {@const showLineBefore = dropIndicator?.index === index && dropIndicator.position === 'before'}
    {#if item}
      <li
        class="group relative flex items-center"
        draggable="true"
        ondragstart={(e) => handleDragStart(e, tabId)}
        ondragend={handleDragEnd}
        ondragover={(e) => handleItemDragOver(e, index)}
        role="tab"
        aria-selected={isActive}
      >
        <!-- 落点指示线（前） -->
        {#if showLineBefore}
          <div class="bg-primary absolute -top-0.5 left-1 right-1 h-0.5 rounded-full"></div>
        {/if}

        <button
          class="hover:bg-accent flex flex-1 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors {isActive
            ? 'bg-accent text-accent-foreground font-medium'
            : 'text-muted-foreground'}"
          onclick={() => handleClick(tabId, isActive)}
          title={collapsed ? item.label : undefined}
        >
          <item.icon class="size-4 shrink-0" />
          {#if !collapsed}
            <span class="truncate">{item.label}</span>
          {/if}
        </button>

        {#if !collapsed}
          <button
            class="hover:bg-accent absolute -right-1 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
            onclick={(e) => handleClose(e, tabId)}
            aria-label="关闭标签页"
          >
            <XIcon class="size-3" />
          </button>
        {/if}

        <!-- 落点指示线（后） -->
        {#if dropIndicator?.index === index && dropIndicator.position === 'after'}
          <div class="bg-primary absolute -bottom-0.5 left-1 right-1 h-0.5 rounded-full"></div>
        {/if}
      </li>
    {/if}
  {/each}
</ul>
