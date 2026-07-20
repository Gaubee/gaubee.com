<!--
	ShoutView：说说/短评列表。
	从 contentStore 的 events 获取数据，按时间展示。
	数据来自 VFS 只读层（构建时静态数据）。
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { contentStore } from '$lib/data/content.svelte'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { Button } from '$lib/components/ui/button'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import * as Card from '$lib/components/ui/card'
  import MessageSquareIcon from '@lucide/svelte/icons/message-square'
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw'

  const state = $derived(contentStore.state)
  const shouts = $derived(contentStore.events)

  onMount(() => {
    if (!state.loaded && !state.loading) {
      contentStore.refresh()
    }
  })

  function formatDate(d: Date): string {
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
  }
</script>

<div class="mx-auto max-w-3xl p-4 sm:p-6">
  <div class="mb-4 flex items-center justify-between">
    <h1 class="text-2xl font-semibold">说说</h1>
    <Button
      variant="outline"
      size="sm"
      onclick={() => contentStore.refresh()}
      disabled={state.loading}
    >
      <RefreshCwIcon data-icon="inline-start" />
      {state.loading ? '加载中' : '刷新'}
    </Button>
  </div>

  {#if state.loading && shouts.length === 0}
    {#each Array(3) as _}
      <Card.Root class="mb-3">
        <Card.Content class="pt-6">
          <Skeleton class="mb-2 h-5 w-3/4" />
          <Skeleton class="mb-3 h-3 w-1/4" />
          <Skeleton class="h-4 w-full" />
        </Card.Content>
      </Card.Root>
    {/each}
  {:else if shouts.length === 0}
    <Card.Root>
      <Card.Content class="flex flex-col items-center gap-3 pt-12 pb-12 text-center">
        <p class="text-muted-foreground">还没有说说</p>
      </Card.Content>
    </Card.Root>
  {:else}
    {#each shouts as shout (shout.path)}
      <Card.Root
        class="mb-3 cursor-pointer transition-colors hover:bg-accent/40"
        role="button"
        tabindex={0}
        onclick={() => navController.navigateMain(`/article/${shout.collection}/${shout.id.stem}`)}
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            navController.navigateMain(`/article/${shout.collection}/${shout.id.stem}`)
          }
        }}
      >
        <Card.Content class="pt-5">
          <div class="text-muted-foreground mb-2 flex items-center gap-2 text-xs">
            <MessageSquareIcon class="size-3.5" />
            <span>短评</span>
            <span>·</span>
            <time>{formatDate(shout.metadata.date)}</time>
          </div>
          <div class="text-sm whitespace-pre-wrap">
            {shout.body}
          </div>
        </Card.Content>
      </Card.Root>
    {/each}
  {/if}
</div>
