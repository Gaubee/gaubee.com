<!--
	正交意图：
	1. 原始需求（2026-07-21）：搜索应用只协调其它应用注册的异步搜索服务。
	2. 解析 Lucene 表达式后并发搜索，并以首批即时、后续 2 秒合并的节奏更新列表。
	3. 用稳定的列表动画呈现分批结果，支持取消过期任务与错误状态。
-->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { flip } from 'svelte/animate'
  import { fade } from 'svelte/transition'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { searchRegisteredServices } from '$lib/search/coordinator'
  import { parseLuceneQuery } from '$lib/search/lucene'
  import type { SearchResult } from '$lib/search/types'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import SearchIcon from '@lucide/svelte/icons/search'
  import XIcon from '@lucide/svelte/icons/x'
  import FileTextIcon from '@lucide/svelte/icons/file-text'

  const INPUT_DEBOUNCE_MS = 220
  const RESULT_BATCH_WINDOW_MS = 2_000

  let query = $state('')
  let results = $state<SearchResult[]>([])
  let searching = $state(false)
  let completed = $state(false)
  let error = $state<string | null>(null)
  let prefersReducedMotion = $state(false)

  let taskController: AbortController | null = null
  let inputTimer: ReturnType<typeof setTimeout> | null = null
  let resultTimer: ReturnType<typeof setTimeout> | null = null

  function formatDate(timestamp: number): string {
    return new Date(timestamp).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  function updateQuery(value: string): void {
    query = value
    if (inputTimer) clearTimeout(inputTimer)

    if (!value.trim()) {
      cancelActiveTask()
      results = []
      searching = false
      completed = false
      error = null
      return
    }

    inputTimer = setTimeout(() => void runSearch(value), INPUT_DEBOUNCE_MS)
  }

  function cancelActiveTask(): void {
    taskController?.abort()
    taskController = null
    if (resultTimer) {
      clearTimeout(resultTimer)
      resultTimer = null
    }
  }

  function publish(buffer: Map<string, SearchResult>): void {
    results = [...buffer.values()].sort(
      (left, right) => right.date - left.date || right.score - left.score,
    )
  }

  function schedulePublish(buffer: Map<string, SearchResult>, controller: AbortController): void {
    if (resultTimer) clearTimeout(resultTimer)
    resultTimer = setTimeout(() => {
      if (taskController !== controller || controller.signal.aborted) return
      publish(buffer)
      resultTimer = null
    }, RESULT_BATCH_WINDOW_MS)
  }

  async function runSearch(source: string): Promise<void> {
    cancelActiveTask()
    const controller = new AbortController()
    taskController = controller
    const buffer = new Map<string, SearchResult>()
    let hasPublishedFirstBatch = false

    try {
      const parsed = parseLuceneQuery(source)
      error = null
      results = []
      searching = true
      completed = false

      for await (const progress of searchRegisteredServices(parsed, controller.signal)) {
        if (taskController !== controller || controller.signal.aborted) return

        if (progress.type === 'batch') {
          for (const result of progress.batch.results) buffer.set(result.id, result)
          if (!hasPublishedFirstBatch && buffer.size > 0) {
            publish(buffer)
            hasPublishedFirstBatch = true
          } else if (hasPublishedFirstBatch) {
            schedulePublish(buffer, controller)
          }
        } else if (progress.type === 'service-error') {
          error = `${progress.appId} 搜索失败：${progress.message}`
        } else if (progress.type === 'complete') {
          searching = false
          completed = true
        }
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        error = cause instanceof Error ? cause.message : '搜索请求失败'
        searching = false
        completed = true
      }
    }
  }

  function openResult(event: MouseEvent, result: SearchResult): void {
    event.preventDefault()
    navController.deactivatePop()
    navController.navigateMain(result.href)
  }

  onMount(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const updateMotionPreference = () => {
      prefersReducedMotion = media.matches
    }
    updateMotionPreference()
    media.addEventListener('change', updateMotionPreference)
    return () => media.removeEventListener('change', updateMotionPreference)
  })

  onDestroy(() => {
    if (inputTimer) clearTimeout(inputTimer)
    cancelActiveTask()
  })
</script>

<section class="mx-auto flex max-w-2xl flex-col gap-4" aria-label="搜索">
  <div class="relative">
    <SearchIcon class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
    <Input
      class="pr-10 pl-9"
      type="search"
      value={query}
      oninput={(event) => updateQuery(event.currentTarget.value)}
      placeholder="搜索内容或输入 app:articles"
      aria-label="搜索内容"
      autofocus
    />
    {#if query}
      <Button
        variant="ghost"
        size="icon-xs"
        class="absolute top-1/2 right-1 -translate-y-1/2"
        aria-label="清除搜索"
        onclick={() => updateQuery('')}
      >
        <XIcon class="size-3.5" />
      </Button>
    {/if}
  </div>

  <div class="sr-only" aria-live="polite">
    {#if searching}
      正在搜索
    {:else if completed}
      找到 {results.length} 条结果
    {/if}
  </div>

  {#if error}
    <p class="rounded-md border border-destructive/30 px-3 py-2 text-sm text-destructive" role="alert">{error}</p>
  {/if}

  {#if !query.trim()}
    <div class="flex min-h-44 flex-col items-center justify-center gap-2 text-center">
      <SearchIcon class="text-muted-foreground size-7" />
      <p class="text-muted-foreground text-sm">输入关键词开始搜索</p>
    </div>
  {:else if searching && results.length === 0}
    <div class="space-y-3" aria-label="正在搜索">
      {#each [0, 1, 2] as row (row)}
        <div class="h-20 animate-pulse rounded-md bg-muted" style={`animation-delay: ${row * 80}ms`}></div>
      {/each}
    </div>
  {:else if completed && results.length === 0 && !error}
    <div class="flex min-h-44 flex-col items-center justify-center gap-2 text-center">
      <FileTextIcon class="text-muted-foreground size-7" />
      <p class="text-muted-foreground text-sm">没有匹配的内容</p>
    </div>
  {:else}
    <div class="divide-y divide-border">
      {#each results as result (result.id)}
        <article
          animate:flip={{ duration: prefersReducedMotion ? 0 : 180 }}
          in:fade={{ duration: prefersReducedMotion ? 0 : 160 }}
          out:fade={{ duration: prefersReducedMotion ? 0 : 120 }}
          class="py-3"
        >
          <a class="block rounded-md px-2 py-1.5 transition-colors hover:bg-muted" href={result.href} onclick={(event) => openResult(event, result)}>
            <div class="text-muted-foreground mb-1 flex items-center gap-2 text-xs">
              <span>{result.appName}</span>
              <span aria-hidden="true">·</span>
              <time>{formatDate(result.date)}</time>
            </div>
            <h2 class="line-clamp-1 text-sm font-semibold">{result.title}</h2>
            <p class="text-muted-foreground mt-1 line-clamp-2 text-sm leading-5">{result.excerpt}</p>
          </a>
        </article>
      {/each}
    </div>
  {/if}
</section>
