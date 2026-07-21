<!--
	正交意图：
	1. 原始需求（2026-07-21）：说说列表接近 X 的时间线，并正确渲染 Markdown。
	2. 从 ReadonlyVFS 按时间倒序读取 events。
	3. 对长内容提供局部展开，且不截断 Markdown 的语义结构。
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { readonlyVfs, type ReadonlyPost } from '$lib/vfs/readonly'
  import { navController } from '$lib/nav/nav-controller-instance'
  import MarkdownViewer from '$lib/markdown/MarkdownViewer.svelte'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import MessageSquareIcon from '@lucide/svelte/icons/message-square'
  import CalendarIcon from '@lucide/svelte/icons/calendar'
  import ArrowUpRightIcon from '@lucide/svelte/icons/arrow-up-right'
  import UserIcon from '@lucide/svelte/icons/user'

  const LONG_SHOUT_CHARACTERS = 560
  const LONG_SHOUT_LINES = 8

  let shouts = $state<ReadonlyPost[]>([])
  let loading = $state(true)
  let expandedIds = $state<Set<string>>(new Set())

  onMount(() => {
    shouts = readonlyVfs
      .getPostsByCollection('events')
      .sort((a, b) => b.metadata.date.getTime() - a.metadata.date.getTime())
    loading = false
  })

  function formatDate(date: Date): string {
    const elapsedDays = Math.floor((Date.now() - date.getTime()) / 86_400_000)
    if (elapsedDays === 0) return '今天'
    if (elapsedDays === 1) return '昨天'
    if (elapsedDays > 1 && elapsedDays < 7) return `${elapsedDays} 天前`
    if (elapsedDays >= 7 && elapsedDays < 30) return `${Math.floor(elapsedDays / 7)} 周前`
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
  }

  function hrefFor(shout: ReadonlyPost): string {
    return `/article/${shout.collection}/${shout.id.stem}`
  }

  function openShout(event: MouseEvent, shout: ReadonlyPost): void {
    event.preventDefault()
    navController.navigateMain(hrefFor(shout))
  }

  function isLong(shout: ReadonlyPost): boolean {
    return shout.body.length > LONG_SHOUT_CHARACTERS || shout.body.split('\n').length > LONG_SHOUT_LINES
  }

  function toggleExpanded(id: string): void {
    const next = new Set(expandedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    expandedIds = next
  }

  function titleFor(shout: ReadonlyPost): string {
    return shout.metadata.title ?? shout.id.slug ?? '查看说说详情'
  }
</script>

<div class="mx-auto max-w-2xl px-4 py-8 sm:px-6">
  <header class="mb-6">
    <div class="flex items-center gap-3">
      <div class="flex size-10 items-center justify-center rounded-lg bg-primary/10">
        <MessageSquareIcon class="text-primary size-5" />
      </div>
      <div>
        <h1 class="text-2xl font-bold">说说</h1>
        <p class="text-muted-foreground text-sm">共 {shouts.length} 条短评</p>
      </div>
    </div>
  </header>

  {#if loading}
    <div class="divide-y divide-border">
      {#each Array(5) as _, index (index)}
        <div class="flex gap-3 py-5" aria-label="正在加载短评">
          <Skeleton class="size-10 shrink-0 rounded-full" />
          <div class="flex-1 space-y-2">
            <Skeleton class="h-4 w-1/4" />
            <Skeleton class="h-4 w-full" />
            <Skeleton class="h-4 w-3/4" />
          </div>
        </div>
      {/each}
    </div>
  {:else if shouts.length === 0}
    <div class="flex flex-col items-center justify-center py-20 text-center">
      <div class="mb-4 flex size-16 items-center justify-center rounded-full bg-muted">
        <MessageSquareIcon class="text-muted-foreground size-8" />
      </div>
      <h2 class="mb-1 text-lg font-medium">暂无短评</h2>
      <p class="text-muted-foreground text-sm">还没有发布任何短评</p>
    </div>
  {:else}
    <div class="divide-y divide-border">
      {#each shouts as shout (shout.path)}
        {@const expanded = expandedIds.has(shout.id.stem)}
        {@const collapsible = isLong(shout)}
        <article class="flex gap-3 py-5">
          <div class="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10" aria-hidden="true">
            <UserIcon class="text-primary size-5" />
          </div>

          <div class="min-w-0 flex-1">
            <div class="mb-2 flex min-w-0 items-center gap-2 text-sm">
              <a
                class="truncate font-semibold hover:underline"
                href={hrefFor(shout)}
                onclick={(event) => openShout(event, shout)}
              >
                Gaubee
              </a>
              <span class="text-muted-foreground" aria-hidden="true">·</span>
              <a
                class="text-muted-foreground inline-flex shrink-0 items-center gap-1 hover:underline"
                href={hrefFor(shout)}
                aria-label={`${titleFor(shout)}，发布于 ${formatDate(shout.metadata.date)}`}
                onclick={(event) => openShout(event, shout)}
              >
                <CalendarIcon class="size-3" />
                <time>{formatDate(shout.metadata.date)}</time>
              </a>
            </div>

            <div class:shout-collapsed={collapsible && !expanded} class="shout-markdown text-[15px] leading-6 text-foreground">
              <MarkdownViewer markdown={shout.body} inline />
            </div>

            <div class="mt-3 flex items-center gap-3">
              {#if collapsible}
                <button class="text-primary text-sm font-medium hover:underline" onclick={() => toggleExpanded(shout.id.stem)}>
                  {expanded ? '收起' : '展开全文'}
                </button>
              {/if}
              <a
                class="text-muted-foreground inline-flex items-center gap-1 text-sm hover:text-foreground"
                href={hrefFor(shout)}
                onclick={(event) => openShout(event, shout)}
              >
                查看详情
                <ArrowUpRightIcon class="size-3.5" />
              </a>
            </div>
          </div>
        </article>
      {/each}
    </div>
  {/if}
</div>

<style>
  .shout-collapsed {
    max-height: 13.5rem;
    overflow: hidden;
  }

  .shout-markdown :global(p) {
    margin-block: 0 0.75rem;
  }

  .shout-markdown :global(p:last-child) {
    margin-bottom: 0;
  }

  .shout-markdown :global(h1),
  .shout-markdown :global(h2),
  .shout-markdown :global(h3) {
    margin-block: 1rem 0.5rem;
    font-size: 1rem;
    font-weight: 600;
    line-height: 1.5;
  }

  .shout-markdown :global(ul),
  .shout-markdown :global(ol) {
    margin: 0.75rem 0;
    padding-left: 1.25rem;
  }

  .shout-markdown :global(blockquote) {
    margin: 0.75rem 0;
    padding-left: 0.75rem;
    color: var(--muted-foreground);
    border-inline-start: 1px solid var(--border);
  }

  .shout-markdown :global(pre) {
    margin: 0.75rem 0;
    max-width: 100%;
  }
</style>
