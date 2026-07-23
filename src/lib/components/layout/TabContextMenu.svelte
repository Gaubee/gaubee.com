<!--
	TabContextMenu：任务栏 tab 的长按/右键上下文菜单。
	pin/unpin（保留在任务栏）+ quit（退出应用）。
	桌面右键(oncontextmenu) + 移动端长按(pointerdown 500ms)触发。
	包裹 tab 内容，透传 children snippet。
-->
<script lang="ts">
  import { navController } from '$lib/nav/nav-controller-instance'
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu'
  import PinIcon from '@lucide/svelte/icons/pin'
  import PinOffIcon from '@lucide/svelte/icons/pin-off'
  import XIcon from '@lucide/svelte/icons/x'
  import type { Snippet } from 'svelte'
  import type { TabId } from '$lib/nav/controller'

  let {
    tabId,
    pinned,
    children,
  }: {
    tabId: TabId
    pinned: boolean
    children: Snippet
  } = $props()

  let open = $state(false)
  let longPressTimer: ReturnType<typeof setTimeout> | null = null

  function startLongPress(e: PointerEvent) {
    if (e.button !== undefined && e.button !== 0) return
    longPressTimer = setTimeout(() => {
      open = true
    }, 500)
  }
  function cancelLongPress() {
    if (longPressTimer) {
      clearTimeout(longPressTimer)
      longPressTimer = null
    }
  }
  function handleContextMenu(e: MouseEvent) {
    e.preventDefault()
    open = true
  }

  function togglePin() {
    if (pinned) navController.unpinTab(tabId)
    else navController.pinTab(tabId)
    open = false
  }
  function quit() {
    navController.quitApp(tabId)
    open = false
  }
</script>

<div
  class="contents"
  role="presentation"
  onpointerdown={startLongPress}
  onpointerup={cancelLongPress}
  onpointerleave={cancelLongPress}
  onpointercancel={cancelLongPress}
  onpointermove={(e) => {
    if (longPressTimer && Math.abs(e.movementX) + Math.abs(e.movementY) > 10) {
      cancelLongPress()
    }
  }}
  oncontextmenu={handleContextMenu}
>
  {@render children()}
</div>

{#if open}
  <DropdownMenu.Root bind:open>
    <DropdownMenu.Trigger />
    <DropdownMenu.Content>
      <DropdownMenu.Item onclick={togglePin}>
        {#if pinned}
          <PinOffIcon class="size-4" />
          <span>取消保留</span>
        {:else}
          <PinIcon class="size-4" />
          <span>保留在任务栏</span>
        {/if}
      </DropdownMenu.Item>
      <DropdownMenu.Separator />
      <DropdownMenu.Item onclick={quit} disabled={pinned}>
        <XIcon class="size-4" />
        <span>退出应用{pinned ? '（需先取消保留）' : ''}</span>
      </DropdownMenu.Item>
    </DropdownMenu.Content>
  </DropdownMenu.Root>
{/if}
