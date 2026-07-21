<!--
	ShoutView：说说/短评列表（纯只读）。
	
	从 ReadonlyVFS（构建时静态数据）读取，无需登录即可阅读。
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { readonlyVfs } from '$lib/vfs/readonly'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import MessageSquareIcon from '@lucide/svelte/icons/message-square'
  import CalendarIcon from '@lucide/svelte/icons/calendar'
  import ArrowRightIcon from '@lucide/svelte/icons/arrow-right'
  import type { ReadonlyPost } from '$lib/vfs/readonly'

  let shouts = $state<ReadonlyPost[]>([])
  let loading = $state(true)

  onMount(() => {
    const events = readonlyVfs.getPostsByCollection('events')
    shouts = events.sort((a, b) => b.metadata.date.getTime() - a.metadata.date.getTime())
    loading = false
  })

  function formatDate(d: Date): string {
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
  }

  function navigateToShout(shout: ReadonlyPost) {
    navController.navigateMain(`/article/${shout.collection}/${shout.id.stem}`)
  }
</script>

<div class="mx-auto max-w-3xl px-4 py-8 sm:px-6">
  <!-- 页面头部 -->
  <header class="mb-10">
    <div class="flex items-center gap-3 mb-2">
      <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
        <MessageSquareIcon class="text-primary size-5" />
      </div>
      <h1 class="text-3xl font-bold tracking-tight">说说</h1>
    </div>
    <p class="text-muted-foreground text-sm ml-[52px]">
      共 {shouts.length} 条短评
    </p>
  </header>

  {#if loading}
    <!-- 骨架屏 -->
    <div class="space-y-4">
      {#each Array(5) as _, i}
        <div class="rounded-2xl border p-5 animate-pulse" style="animation-delay: {i * 100}ms">
          <Skeleton class="mb-3 h-4 w-1/3" />
          <Skeleton class="h-16 w-full" />
        </div>
      {/each}
    </div>
  {:else if shouts.length === 0}
    <!-- 空状态 -->
    <div class="flex flex-col items-center justify-center py-20 text-center">
      <div class="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
        <MessageSquareIcon class="text-muted-foreground size-8" />
      </div>
      <h3 class="mb-1 text-lg font-medium">暂无短评</h3>
      <p class="text-muted-foreground text-sm">还没有发布任何短评</p>
    </div>
  {:else}
    <!-- 短评列表 -->
    <div class="space-y-4">
      {#each shouts as shout, index (shout.path)}
        <article
          class="group cursor-pointer overflow-hidden rounded-2xl border bg-card transition-all duration-300 hover:shadow-lg hover:shadow-primary/5 hover:border-primary/20"
          style="animation: fadeInUp 0.5s ease-out {index * 0.05}s both;"
          onclick={() => navigateToShout(shout)}
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              navigateToShout(shout)
            }
          }}
          role="button"
          tabindex={0}
        >
          <div class="p-5 sm:p-6">
            <!-- 日期 -->
            <div class="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
              <CalendarIcon class="size-3.5" />
              <time>{formatDate(shout.metadata.date)}</time>
            </div>

            <!-- 正文 -->
            <p class="text-sm leading-relaxed whitespace-pre-wrap text-foreground/90 mb-4">
              {shout.body}
            </p>

            <!-- 阅读更多 -->
            <div class="flex items-center gap-1 text-sm font-medium text-primary opacity-0 translate-x-[-8px] transition-all duration-300 group-hover:opacity-100 group-hover:translate-x-0">
              <span>查看详情</span>
              <ArrowRightIcon class="size-4" />
            </div>
          </div>

          <!-- 左侧装饰条 -->
          <div class="absolute top-0 left-0 h-full w-1 bg-primary/0 transition-colors duration-300 group-hover:bg-primary/20" />
        </article>
      {/each}
    </div>
  {/if}
</div>

<style>
  @keyframes fadeInUp {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
