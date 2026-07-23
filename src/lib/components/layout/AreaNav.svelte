<!--
	AreaNav：某 area 的 tab 列表组件。
	- 从 AppManager 获取应用元数据（图标、名称）。
	- main area：点击 tab 走 navigateMain（router push）。
	- bottom area：点击 tab 是 toggle（activate/deactivate）。
	- HTML5 拖拽：跨 area moveTab + 同 area reorder，带落点指示线。
-->
<script lang="ts">
  import { navStore } from '$lib/nav/nav.svelte'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { draggedTabId, setDraggedTab } from '$lib/nav/drag-state.svelte'
  import { appManager } from '$lib/apps/AppManager.svelte'
  import { matchesRoutePrefix, routeDomainRegistry } from '$lib/apps/route-domain'
  import TabContextMenu from './TabContextMenu.svelte'
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
  const isPinned = (tabId: TabId) => navState.pinnedTabs.includes(tabId)

  // 当前激活的 tab id：优先查路由域表（识别应用子场景，详情页也能高亮入口 tab），
  // fallback 到 entry route 前缀匹配。
  const activeTabId = $derived.by(() => {
    const loc = area === 'main' ? navState.mainLocation : navState.bottomLocation
    const resolved = routeDomainRegistry.entryRouteForPath(loc.pathname)
    if (resolved && tabs.includes(resolved)) return resolved
    for (const tabId of tabs) {
      if (matchesRoutePrefix(loc.pathname, tabId)) {
        return tabId
      }
    }
    return null
  })

  // 从 AppManager 获取应用信息
  function getAppInfo(route: string) {
    return appManager.findByRoute(route)
  }

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
      // Dock 图标聚焦：恢复该应用最后场景，不重置到入口（iPadOS Dock 语义）
      navController.focusApp(tabId)
    } else {
      // bottom：toggle
      if (isActive) navController.deactivateBottom()
      else navController.activateBottom(tabId)
    }
  }

  function handleClose(e: MouseEvent, tabId: TabId) {
    e.stopPropagation()
    // 新任务栏模型：X 按钮 = 退出应用（移除+销毁）；pinned 时无效（需先取消保留）
    navController.quitApp(tabId)
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
    {@const app = getAppInfo(tabId)}
    {@const isActive = tabId === activeTabId}
    {@const showLineBefore = dropIndicator?.index === index && dropIndicator.position === 'before'}
    {#if app}
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

        <TabContextMenu {tabId} pinned={isPinned(tabId)}>
          <button
            class="hover:bg-accent flex flex-1 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors {isActive
              ? 'bg-accent text-accent-foreground font-medium'
              : 'text-muted-foreground'}"
            onclick={() => handleClick(tabId, isActive)}
            title={collapsed ? app.name : undefined}
          >
            <!-- svelte-ignore ownership_invalid_mutation -->
            <app.icon class="size-4 shrink-0" />
            {#if !collapsed}
              <span class="truncate">{app.name}</span>
            {/if}
          </button>
        </TabContextMenu>

        {#if !collapsed}
          <button
            class="hover:bg-accent absolute -right-1 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
            onclick={(e) => handleClose(e, tabId)}
            aria-label="退出应用"
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
