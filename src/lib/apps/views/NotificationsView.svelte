<!--
	NotificationsView：通知中心（pop 浮层）。
	从 NotificationService 读取历史记录，支持全部已读 / 清空。
-->
<script lang="ts">
  import { gaubeeos } from '$lib/os/services'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { Button } from '$lib/components/ui/button'
  import * as Card from '$lib/components/ui/card'
  import BellIcon from '@lucide/svelte/icons/bell'
  import CheckCheckIcon from '@lucide/svelte/icons/check-check'
  import TrashIcon from '@lucide/svelte/icons/trash'
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right'

  // 系统应用 notification 始终可用
  const service = $derived(gaubeeos.getAppService('notification'))
  const history = $derived(service?.history ?? [])
  const unreadCount = $derived(service?.unreadCount ?? 0)

  /** 点击通知卡片：有 action 则跳转，并标记全部已读。 */
  function handleClick(action?: { href: string }): void {
    service?.markAllRead()
    if (action) navController.navigateMain(action.href)
  }

  function severityColor(sev: string): string {
    switch (sev) {
      case 'error':
        return 'text-destructive'
      case 'success':
        return 'text-emerald-500'
      case 'warning':
        return 'text-amber-500'
      default:
        return 'text-muted-foreground'
    }
  }

  function formatTime(ts: number): string {
    const d = new Date(ts)
    const now = Date.now()
    const diff = now - ts
    if (diff < 60_000) return '刚刚'
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
    return d.toLocaleDateString('zh-CN')
  }
</script>

<div class="mx-auto max-w-2xl p-4 sm:p-6">
  <div class="mb-4 flex items-center justify-between">
    <h1 class="text-2xl font-semibold">
      通知
      {#if unreadCount > 0}
        <span class="bg-primary text-primary-foreground ml-2 rounded-full px-2 py-0.5 text-xs align-middle">
          {unreadCount}
        </span>
      {/if}
    </h1>
    <div class="flex gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={unreadCount === 0}
        onclick={() => service?.markAllRead()}
      >
        <CheckCheckIcon data-icon="inline-start" />
        全部已读
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={history.length === 0}
        onclick={() => service?.clear()}
      >
        <TrashIcon data-icon="inline-start" />
        清空
      </Button>
    </div>
  </div>

  {#if history.length === 0}
    <Card.Root>
      <Card.Content class="flex flex-col items-center gap-3 pt-12 pb-12 text-center">
        <BellIcon class="text-muted-foreground size-8" />
        <p class="text-muted-foreground">暂无通知</p>
      </Card.Content>
    </Card.Root>
  {:else}
    <div class="flex flex-col gap-2">
      {#each history as n (n.id)}
        <Card.Root class={!n.read ? 'border-primary/40' : ''}>
          <Card.Content
            class={['py-3', n.action ? 'cursor-pointer transition-colors hover:bg-accent' : '']}
            role={n.action ? 'button' : undefined}
            tabindex={n.action ? 0 : undefined}
            onclick={n.action ? () => handleClick(n.action) : undefined}
            onkeydown={n.action ? (e) => (e.key === 'Enter' || e.key === ' ') && handleClick(n.action) : undefined}
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  {#if !n.read}
                    <span class="bg-primary size-2 shrink-0 rounded-full"></span>
                  {/if}
                  <p class="font-medium {severityColor(n.severity)}">{n.title}</p>
                </div>
                {#if n.message}
                  <p class="text-muted-foreground mt-0.5 text-sm break-words">{n.message}</p>
                {/if}
                {#if n.action}
                  <span class="text-primary mt-1 inline-flex items-center gap-0.5 text-xs">
                    {n.action.label}
                    <ChevronRightIcon class="size-3" />
                  </span>
                {/if}
              </div>
              <div class="flex shrink-0 items-center gap-1">
                <span class="text-muted-foreground text-xs">{formatTime(n.timestamp)}</span>
                {#if n.action}
                  <ChevronRightIcon class="text-muted-foreground size-4" />
                {/if}
              </div>
            </div>
          </Card.Content>
        </Card.Root>
      {/each}
    </div>
  {/if}
</div>
