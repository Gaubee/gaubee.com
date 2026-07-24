<!--
	LaunchpadDialog：管理桌面（应用显示/隐藏/排序）。
	受 desktopLayout.launchpadOpen 控制。两组布局：
	- 上组"桌面显示"：可拖拽排序（组内 reorder），可拖到下组隐藏。
	- 下组"已隐藏"：可拖到上组显示。
	HTML5 DnD + flip 动画。
-->
<script lang="ts">
  import { appManager } from '$lib/apps/AppManager.svelte'
  import { desktopLayout } from '$lib/apps/desktop-layout.svelte'
  import * as Dialog from '$lib/components/ui/dialog'
  import { flip } from 'svelte/animate'
  import EyeIcon from '@lucide/svelte/icons/eye'
  import EyeOffIcon from '@lucide/svelte/icons/eye-off'
  import type { InstalledApp } from '$lib/apps/types'

  const visibleApps = $derived(desktopLayout.visibleApps(appManager.allInstalled))
  const hiddenApps = $derived(desktopLayout.hiddenApps(appManager.allInstalled))

  // 拖拽状态：draggedAppId + 拖拽来源组
  let draggedAppId = $state<string | null>(null)
  let draggedFrom = $state<'visible' | 'hidden' | null>(null)
  let dropTarget = $state<{ id: string; position: 'before' | 'after' } | null>(null)

  function handleDragStart(e: DragEvent, app: InstalledApp, from: 'visible' | 'hidden') {
    draggedAppId = app.id
    draggedFrom = from
    if (e.dataTransfer) {
      e.dataTransfer.setData('text/plain', app.id)
      e.dataTransfer.effectAllowed = 'move'
    }
  }

  function handleDragEnd() {
    draggedAppId = null
    draggedFrom = null
    dropTarget = null
  }

  // 显示组内拖拽悬停：计算落点（before/after）
  function handleVisibleDragOver(e: DragEvent, app: InstalledApp) {
    if (!draggedAppId) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const midX = rect.left + rect.width / 2
    dropTarget = { id: app.id, position: e.clientX < midX ? 'before' : 'after' }
  }

  function handleVisibleDrop(e: DragEvent, targetApp: InstalledApp) {
    e.preventDefault()
    e.stopPropagation()
    const appId = draggedAppId
    if (!appId) return
    const from = draggedFrom

    if (from === 'hidden') {
      // 跨组：隐藏→显示，先加入显示组，再排序到落点
      desktopLayout.moveToVisible(appId)
    }
    // 组内排序到落点
    if (appId !== targetApp.id) {
      // 插入到 target 前/后
      const apps = [...desktopLayout.desktopApps]
      const idx = apps.indexOf(appId)
      if (idx !== -1) apps.splice(idx, 1)
      const targetIdx = apps.indexOf(targetApp.id)
      if (targetIdx !== -1) {
        apps.splice(dropTarget?.position === 'after' ? targetIdx + 1 : targetIdx, 0, appId)
        // 直接重设 desktopApps（绕过 reorder 的简单逻辑，支持精确落点）
        desktopLayout.desktopApps = apps
      }
    }
    handleDragEnd()
  }

  function handleHiddenDrop(e: DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    const appId = draggedAppId
    if (!appId || draggedFrom !== 'visible') return
    // 跨组：显示→隐藏
    desktopLayout.moveToHidden(appId)
    handleDragEnd()
  }

  function handleAreaDragOver(e: DragEvent) {
    if (!draggedAppId) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  }

  // 切换显隐（点击图标快捷操作）
  function toggle(app: InstalledApp, isVisible: boolean) {
    if (isVisible) desktopLayout.moveToHidden(app.id)
    else desktopLayout.moveToVisible(app.id)
  }
</script>

<Dialog.Root
  open={desktopLayout.launchpadOpen}
  onOpenChange={(v) => { if (!v) desktopLayout.closeLaunchpad() }}
>
  <Dialog.Content class="max-h-[85vh] max-w-2xl overflow-hidden p-0">
    <Dialog.Header class="flex-row items-center gap-2 border-b px-4 py-3">
      <Dialog.Title>管理桌面</Dialog.Title>
      <Dialog.Description class="sr-only">管理桌面应用显示、隐藏与排序</Dialog.Description>
    </Dialog.Header>

    <div class="max-h-[70vh] space-y-4 overflow-auto p-4">
      <!-- 上组：桌面显示 -->
      <section>
        <h3 class="text-muted-foreground mb-2 flex items-center gap-1.5 text-xs font-medium">
          <EyeIcon class="size-3.5" />
          桌面显示（{visibleApps.length}）
        </h3>
        <div
          class="grid grid-cols-[repeat(auto-fill,minmax(5rem,1fr))] gap-2 rounded-lg border border-dashed p-2"
          role="list"
          ondragover={handleAreaDragOver}
          ondrop={(e) => {
            // 空白处 drop（无 targetApp）：隐藏→显示追加末尾
            if (draggedFrom === 'hidden' && draggedAppId) {
              e.preventDefault()
              desktopLayout.moveToVisible(draggedAppId)
              handleDragEnd()
            }
          }}
        >
          {#each visibleApps as app, i (app.id)}
            <button
              class="hover:bg-accent group relative flex flex-col items-center gap-1 rounded-lg border p-2 transition-colors {draggedAppId === app.id ? 'opacity-40' : ''} {dropTarget?.id === app.id ? 'ring-2 ring-primary' : ''}"
              draggable="true"
              ondragstart={(e) => handleDragStart(e, app, 'visible')}
              ondragend={handleDragEnd}
              ondragover={(e) => handleVisibleDragOver(e, app)}
              ondrop={(e) => handleVisibleDrop(e, app)}

              animate:flip={{ duration: 200 }}
            >
              <!-- svelte-ignore ownership_invalid_mutation -->
              <app.icon class="size-6" />
              <span class="w-full truncate text-center text-xs">{app.name}</span>
              <span
                class="text-muted-foreground absolute top-0.5 right-0.5 hidden size-5 items-center justify-center rounded-full bg-background group-hover:flex"
                role="button"
                tabindex="0"
                onclick={(e) => { e.stopPropagation(); toggle(app, true) }}
                onkeydown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); toggle(app, true) } }}
                aria-label="从桌面隐藏"
              >
                <EyeOffIcon class="size-3" />
              </span>
            </button>
          {:else}
            <p class="text-muted-foreground col-span-full py-4 text-center text-xs">拖拽下方应用到这里显示</p>
          {/each}
        </div>
      </section>

      <!-- 下组：已隐藏 -->
      <section>
        <h3 class="text-muted-foreground mb-2 flex items-center gap-1.5 text-xs font-medium">
          <EyeOffIcon class="size-3.5" />
          已隐藏（{hiddenApps.length}）
        </h3>
        <div
          class="grid grid-cols-[repeat(auto-fill,minmax(5rem,1fr))] gap-2 rounded-lg border border-dashed p-2"
          role="list"
          ondragover={handleAreaDragOver}
          ondrop={handleHiddenDrop}
        >
          {#each hiddenApps as app (app.id)}
            <button
              class="hover:bg-accent group relative flex flex-col items-center gap-1 rounded-lg border p-2 opacity-60 transition-opacity {draggedAppId === app.id ? 'opacity-40' : ''}"
              draggable="true"
              ondragstart={(e) => handleDragStart(e, app, 'hidden')}
              ondragend={handleDragEnd}

              animate:flip={{ duration: 200 }}
            >
              <!-- svelte-ignore ownership_invalid_mutation -->
              <app.icon class="size-6" />
              <span class="w-full truncate text-center text-xs">{app.name}</span>
              <span
                class="absolute top-0.5 right-0.5 hidden size-5 items-center justify-center rounded-full bg-background text-muted-foreground group-hover:flex"
                role="button"
                tabindex="0"
                onclick={(e) => { e.stopPropagation(); toggle(app, false) }}
                onkeydown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); toggle(app, false) } }}
                aria-label="显示在桌面"
              >
                <EyeIcon class="size-3" />
              </span>
            </button>
          {:else}
            <p class="text-muted-foreground col-span-full py-4 text-center text-xs">没有隐藏的应用</p>
          {/each}
        </div>
      </section>
    </div>
  </Dialog.Content>
</Dialog.Root>
