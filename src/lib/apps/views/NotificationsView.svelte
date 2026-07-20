<!--
	NotificationsView：通知中心。
	显示 toast 历史通知（目前为占位实现，后续可接入 toast 历史记录）。
-->
<script lang="ts">
  import { Button } from '$lib/components/ui/button'
  import * as Card from '$lib/components/ui/card'
  import BellIcon from '@lucide/svelte/icons/bell'
  import { navController } from '$lib/nav/nav-controller-instance'

  // 占位：后续可接入 toast 历史记录
  const notifications: Array<{ title: string; message: string; time: string }> = []
</script>

<div class="mx-auto max-w-2xl p-4 sm:p-6">
  <div class="mb-4 flex items-center justify-between">
    <h1 class="text-2xl font-semibold">通知</h1>
    <Button variant="outline" size="sm" disabled={notifications.length === 0}>
      全部已读
    </Button>
  </div>

  {#if notifications.length === 0}
    <Card.Root>
      <Card.Content class="flex flex-col items-center gap-3 pt-12 pb-12 text-center">
        <BellIcon class="text-muted-foreground size-8" />
        <p class="text-muted-foreground">暂无通知</p>
      </Card.Content>
    </Card.Root>
  {:else}
    {#each notifications as n (n.time + n.title)}
      <Card.Root class="mb-2">
        <Card.Content class="py-3">
          <div class="flex items-start justify-between gap-2">
            <div>
              <p class="font-medium">{n.title}</p>
              <p class="text-muted-foreground text-sm">{n.message}</p>
            </div>
            <span class="text-muted-foreground text-xs">{n.time}</span>
          </div>
        </Card.Content>
      </Card.Root>
    {/each}
  {/if}
</div>
