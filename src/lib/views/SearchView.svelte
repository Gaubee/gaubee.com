<!--
	正交意图：
	1. 搜索是独立应用（main 区常驻标签）：切走再切回不丢查询、结果与滚动位置。
	2. 会话层补齐：搜索历史（localStorage）、结果缓存（内存 10 分钟）、
	   最近一次搜索刷新后恢复（sessionStorage 30 分钟）。
	3. 仍只协调各应用注册的异步搜索服务；本视图不直接访问数据源。
-->
<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte'
  import { flip } from 'svelte/animate'
  import { fade } from 'svelte/transition'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { searchRegisteredServices } from '$lib/search/coordinator'
  import { parseLuceneQuery } from '$lib/search/lucene'
  import {
    clearHistory,
    forgetQuery,
    loadHistory,
    loadSortMode,
    normalizeQuery,
    readCache,
    readSnapshot,
    rememberQuery,
    saveSortMode,
    writeCache,
    writeSnapshot,
    type SearchAppFilter,
    type SearchSortMode,
  } from '$lib/search/search-session'
  import type { SearchResult } from '$lib/search/types'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import SearchIcon from '@lucide/svelte/icons/search'
  import XIcon from '@lucide/svelte/icons/x'
  import HistoryIcon from '@lucide/svelte/icons/history'
  import FileTextIcon from '@lucide/svelte/icons/file-text'
  import LoaderIcon from '@lucide/svelte/icons/loader'

  const INPUT_DEBOUNCE_MS = 220
  const RESULT_BATCH_WINDOW_MS = 2_000

  const FILTERS: Array<{ id: SearchAppFilter; label: string }> = [
    { id: 'all', label: '全部' },
    { id: 'articles', label: '文章' },
    { id: 'event', label: '事件' },
  ]

  let query = $state('')
  let filter = $state<SearchAppFilter>('all')
  /** 默认时间逆序；可切到相关性优先，偏好记在 localStorage。 */
  let sortMode = $state<SearchSortMode>('time')
  let results = $state<SearchResult[]>([])
  let searching = $state(false)
  let completed = $state(false)
  let error = $state<string | null>(null)
  let history = $state<string[]>([])
  let elapsedMs = $state(0)
  let usedCache = $state(false)
  let selectedIndex = $state(-1)
  let prefersReducedMotion = $state(false)
  let inputEl = $state<HTMLInputElement | null>(null)

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

  function activeSource(): string {
    return filter === 'all' ? query : `${query} app:${filter}`
  }

  function resetResults(): void {
    results = []
    searching = false
    completed = false
    error = null
    elapsedMs = 0
    usedCache = false
    selectedIndex = -1
  }

  function applyResults(next: SearchResult[]): void {
    results = next
    completed = true
    searching = false
    error = null
  }

  function updateQuery(value: string): void {
    query = value
    if (inputTimer) clearTimeout(inputTimer)

    const normalized = normalizeQuery(value)
    if (!normalized) {
      cancelActiveTask()
      resetResults()
      return
    }

    // 缓存命中就立刻出结果；仍保留防抖，用户继续输入时以新查询为准。
    const cached = readCache(filter, normalized)
    if (cached) {
      cancelActiveTask()
      applyResults(sortResults(cached))
      elapsedMs = 0
      usedCache = true
      selectedIndex = -1
      return
    }

    inputTimer = setTimeout(() => void runSearch(value), INPUT_DEBOUNCE_MS)
  }

  function changeFilter(next: SearchAppFilter): void {
    if (filter === next) return
    filter = next
    selectedIndex = -1
    if (normalizeQuery(query)) {
      if (inputTimer) clearTimeout(inputTimer)
      void runSearch(query)
    }
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
    results = sortResults([...buffer.values()])
  }

  function sortResults(list: SearchResult[]): SearchResult[] {
    return [...list].sort(sortMode === 'relevance' ? byRelevance : byTime)
  }

  /** 默认排序：时间逆序，同一天再比相关性。 */
  function byTime(left: SearchResult, right: SearchResult): number {
    return right.date - left.date || right.score - left.score
  }

  /** 相关性优先，同分再看时间。服务端分数是 RRF/余弦，跨应用也大致可比。 */
  function byRelevance(left: SearchResult, right: SearchResult): number {
    return right.score - left.score || right.date - left.date
  }

  function changeSort(mode: SearchSortMode): void {
    if (sortMode === mode) return
    sortMode = mode
    saveSortMode(mode)
    results = sortResults(results)
  }

  function schedulePublish(buffer: Map<string, SearchResult>, controller: AbortController): void {
    if (resultTimer) clearTimeout(resultTimer)
    resultTimer = setTimeout(() => {
      if (taskController !== controller || controller.signal.aborted) return
      publish(buffer)
      resultTimer = null
    }, RESULT_BATCH_WINDOW_MS)
  }

  async function runSearch(source: string, options: { useCache?: boolean } = {}): Promise<void> {
    const normalized = normalizeQuery(source)
    if (!normalized) {
      cancelActiveTask()
      resetResults()
      return
    }

    if (options.useCache !== false) {
      const cached = readCache(filter, normalized)
      if (cached) {
        cancelActiveTask()
        applyResults(sortResults(cached))
        elapsedMs = 0
        usedCache = true
        selectedIndex = -1
        return
      }
    }

    cancelActiveTask()
    const controller = new AbortController()
    taskController = controller
    const buffer = new Map<string, SearchResult>()
    const startedAt = performance.now()
    let hasPublishedFirstBatch = false

    try {
      const parsed = parseLuceneQuery(activeSource())
      error = null
      results = []
      searching = true
      completed = false
      elapsedMs = 0
      usedCache = false
      selectedIndex = -1

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
          const final = sortResults([...buffer.values()])
          results = final
          searching = false
          completed = true
          elapsedMs = Math.round(performance.now() - startedAt)
          writeCache(filter, normalized, final)
          writeSnapshot(normalized, filter, final)
          history = rememberQuery(normalized)
        }
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        error = cause instanceof Error ? cause.message : '搜索请求失败'
        searching = false
        completed = true
        elapsedMs = Math.round(performance.now() - startedAt)
      }
    }
  }

  function searchNow(): void {
    if (inputTimer) clearTimeout(inputTimer)
    void runSearch(query, { useCache: false })
  }

  function openResult(result: SearchResult): void {
    navController.navigateMain(result.href)
  }

  function runFromHistory(item: string): void {
    query = item
    filter = 'all'
    selectedIndex = -1
    if (inputTimer) clearTimeout(inputTimer)
    void runSearch(item)
    void tick().then(() => inputEl?.focus())
  }

  function removeHistory(item: string): void {
    history = forgetQuery(item)
  }

  function clearAllHistory(): void {
    history = clearHistory()
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      if (selectedIndex >= 0 && results[selectedIndex]) {
        openResult(results[selectedIndex])
        return
      }
      searchNow()
      return
    }
    if (event.key === 'ArrowDown' && results.length > 0) {
      event.preventDefault()
      selectedIndex = Math.min(selectedIndex + 1, results.length - 1)
      return
    }
    if (event.key === 'ArrowUp' && results.length > 0) {
      event.preventDefault()
      selectedIndex = Math.max(selectedIndex - 1, -1)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      updateQuery('')
    }
  }

  onMount(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const updateMotionPreference = () => {
      prefersReducedMotion = media.matches
    }
    updateMotionPreference()
    media.addEventListener('change', updateMotionPreference)

    history = loadHistory()
    sortMode = loadSortMode()
    const snapshot = readSnapshot()
    if (snapshot) {
      query = snapshot.query
      filter = snapshot.filter
      applyResults(sortResults(snapshot.results))
      elapsedMs = 0
      usedCache = true
    }

    return () => media.removeEventListener('change', updateMotionPreference)
  })

  onDestroy(() => {
    if (inputTimer) clearTimeout(inputTimer)
    cancelActiveTask()
  })
</script>

<section class="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 sm:p-6" aria-label="搜索">
  <header class="flex items-end justify-between gap-3">
    <div>
      <h1 class="text-xl font-semibold tracking-tight">搜索</h1>
      <p class="text-muted-foreground mt-1 text-sm">
        跨文章与事件检索，支持自然语言，也可用 <code class="text-xs">app:articles</code> 限定范围
      </p>
    </div>
  </header>

  <div class="relative">
    <SearchIcon
      class="text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2"
    />
    <Input
      bind:ref={inputEl}
      class="border-border/60 h-11 pr-10 pl-10 text-base [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
      type="search"
      value={query}
      oninput={(event) => updateQuery(event.currentTarget.value)}
      onkeydown={onKeydown}
      placeholder="搜索内容，例如：异步运行时是怎么实现的"
      aria-label="搜索内容"
      autofocus
    />
    {#if query}
      <Button
        variant="ghost"
        size="icon-xs"
        class="absolute top-1/2 right-1.5 -translate-y-1/2"
        aria-label="清除搜索"
        onclick={() => updateQuery('')}
      >
        <XIcon class="size-3.5" />
      </Button>
    {/if}
  </div>

  <div class="flex flex-wrap items-center gap-2">
    {#each FILTERS as option (option.id)}
      <button
        type="button"
        class="h-8 rounded-full border px-3 text-xs transition-colors"
        class:border-primary={filter === option.id}
        class:bg-primary={filter === option.id}
        class:text-primary-foreground={filter === option.id}
        class:text-muted-foreground={filter !== option.id}
        class:hover:bg-muted={filter !== option.id}
        aria-pressed={filter === option.id}
        onclick={() => changeFilter(option.id)}
      >
        {option.label}
      </button>
    {/each}
    <div
      class="border-border/70 flex items-center gap-0.5 rounded-full border p-0.5"
      role="group"
      aria-label="排序方式"
    >
      <button
        type="button"
        class="h-7 rounded-full px-2.5 text-xs transition-colors"
        class:bg-muted={sortMode === 'time'}
        class:text-foreground={sortMode === 'time'}
        class:text-muted-foreground={sortMode !== 'time'}
        aria-pressed={sortMode === 'time'}
        onclick={() => changeSort('time')}
      >
        最新
      </button>
      <button
        type="button"
        class="h-7 rounded-full px-2.5 text-xs transition-colors"
        class:bg-muted={sortMode === 'relevance'}
        class:text-foreground={sortMode === 'relevance'}
        class:text-muted-foreground={sortMode !== 'relevance'}
        aria-pressed={sortMode === 'relevance'}
        onclick={() => changeSort('relevance')}
      >
        相关
      </button>
    </div>
    {#if completed && query.trim()}
      <span class="text-muted-foreground ml-auto text-xs tabular-nums">
        {results.length} 条结果
        {#if elapsedMs > 0}· {elapsedMs}ms{/if}
        {#if usedCache}· 缓存{/if}
      </span>
    {:else if searching}
      <span class="text-muted-foreground ml-auto flex items-center gap-1.5 text-xs">
        <LoaderIcon class="size-3.5 animate-spin" />
        搜索中
      </span>
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
    <p
      class="border-destructive/30 text-destructive rounded-md border px-3 py-2 text-sm"
      role="alert"
    >
      {error}
    </p>
  {/if}

  {#if !query.trim()}
    {#if history.length > 0}
      <section class="overflow-hidden rounded-lg border" aria-label="最近搜索">
        <div class="text-muted-foreground bg-muted/40 flex items-center gap-2 px-3 py-2 text-xs">
          <span class="flex items-center gap-2">
            <HistoryIcon class="size-3.5" />
            最近搜索
          </span>
          <button
            type="button"
            class="hover:text-foreground ml-auto rounded px-1.5 py-0.5 text-xs transition-colors"
            onclick={clearAllHistory}
          >
            清空记录
          </button>
        </div>
        <ul class="divide-y">
          {#each history as item (item)}
            <li class="group flex items-center">
              <button
                type="button"
                class="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted"
                onclick={() => runFromHistory(item)}
              >
                <SearchIcon class="text-muted-foreground size-3.5 shrink-0" />
                <span class="truncate">{item}</span>
              </button>
              <button
                type="button"
                class="text-muted-foreground hover:text-foreground mr-2 rounded p-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                aria-label={`删除搜索记录：${item}`}
                onclick={() => removeHistory(item)}
              >
                <XIcon class="size-3.5" />
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {:else}
      <div class="flex min-h-52 flex-col items-center justify-center gap-2 text-center">
        <SearchIcon class="text-muted-foreground size-7" />
        <p class="text-muted-foreground text-sm">输入关键词开始搜索</p>
        <p class="text-muted-foreground/70 text-xs">
          支持 <kbd class="rounded border px-1">↑</kbd>
          <kbd class="rounded border px-1">↓</kbd> 选择，
          <kbd class="rounded border px-1">Enter</kbd> 打开，
          <kbd class="rounded border px-1">Esc</kbd> 清空
        </p>
      </div>
    {/if}
  {:else if searching && results.length === 0}
    <div class="space-y-3" aria-label="正在搜索">
      {#each [0, 1, 2] as row (row)}
        <div
          class="h-20 animate-pulse rounded-md bg-muted"
          style={`animation-delay: ${row * 80}ms`}
        ></div>
      {/each}
    </div>
  {:else if completed && results.length === 0 && !error}
    <div class="flex min-h-52 flex-col items-center justify-center gap-2 text-center">
      <FileTextIcon class="text-muted-foreground size-7" />
      <p class="text-muted-foreground text-sm">没有匹配的内容</p>
      <p class="text-muted-foreground/70 text-xs">试试更短的关键词，或切换上方范围</p>
    </div>
  {:else}
    <div class="divide-y">
      {#each results as result, index (result.id)}
        <article
          animate:flip={{ duration: prefersReducedMotion ? 0 : 180 }}
          in:fade={{ duration: prefersReducedMotion ? 0 : 160 }}
          out:fade={{ duration: prefersReducedMotion ? 0 : 120 }}
        >
          <a
            class="group -mx-3 block rounded-lg px-3 py-3 transition-colors hover:bg-muted"
            class:bg-muted={selectedIndex === index}
            href={result.href}
            onclick={(event) => {
              event.preventDefault()
              openResult(result)
            }}
            onmouseenter={() => (selectedIndex = index)}
          >
            <div class="text-muted-foreground mb-1.5 flex items-center gap-2 text-xs">
              <span class="bg-muted text-foreground/80 rounded px-1.5 py-0.5">{result.appName}</span>
              <time>{formatDate(result.date)}</time>
            </div>
            <h2 class="line-clamp-1 text-sm font-semibold group-hover:underline group-hover:decoration-muted-foreground/40 group-hover:underline-offset-2">{result.title}</h2>
            <p class="text-muted-foreground mt-1 line-clamp-2 text-sm leading-5">
              {result.excerpt}
            </p>
          </a>
        </article>
      {/each}
    </div>
  {/if}
</section>
