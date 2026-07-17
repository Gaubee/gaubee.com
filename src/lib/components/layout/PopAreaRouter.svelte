<!--
	PopAreaRouter：pop 区浮层路由器。
	用 shadcn Dialog 渲染，popActive 时显示，Esc/点击遮罩关闭。
	内容区按 pop location 渲染对应 view（SearchView / NotificationsView 等）。
-->
<script lang="ts">
  import { navStore } from '$lib/nav/nav.svelte'
  import { navController } from '$lib/nav/nav-controller-instance'
  import AreaOutlet from './AreaOutlet.svelte'
  import * as Dialog from '$lib/components/ui/dialog'
  import SearchIcon from '@lucide/svelte/icons/search'
  import BellIcon from '@lucide/svelte/icons/bell'
  import type { Component } from 'svelte'

  const navState = $derived(navStore.current)

  // 根据当前 pop 路径决定标题与图标
  const title = $derived.by(() => {
    const path = navState.popLocation.pathname
    if (path.startsWith('/search')) return '搜索'
    if (path.startsWith('/notifications')) return '通知'
    return '弹层'
  })
  const TitleIcon = $derived<Component>(
    navState.popLocation.pathname.startsWith('/notifications') ? BellIcon : SearchIcon
  )

  let open = $derived(navState.popActive)

  // 受控关闭：Dialog 的 onOpenChange 把 false 时同步回 NavController
  function handleOpenChange(value: boolean) {
    if (!value && navState.popActive) {
      navController.deactivatePop()
    }
  }
</script>

<Dialog.Root open={open} onOpenChange={handleOpenChange}>
  <Dialog.Content class="max-h-[85vh] max-w-2xl overflow-hidden p-0">
    <Dialog.Header class="flex-row items-center gap-2 border-b px-4 py-3">
      <TitleIcon class="size-4" />
      <Dialog.Title>{title}</Dialog.Title>
    </Dialog.Header>
    <div class="max-h-[70vh] overflow-auto p-4">
      <AreaOutlet area="pop" />
    </div>
  </Dialog.Content>
</Dialog.Root>
