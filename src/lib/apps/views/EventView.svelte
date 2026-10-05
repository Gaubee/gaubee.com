<!--
	EventView：gaubeeOS「事件」应用列表（2026-10-05 kzf 裁决：说说改名事件，shout → event）。

	正交意图：
	1. 原始需求（2026-07-21）：列表正确渲染 Markdown（时间线式阅读）。
	2. 从内容管道（contentQuery）按时间倒序读取 events。
	3. [2026-10-05] 按月分页 + 时间轴导航（年 + 月，仅有数据的月份显示）：
	   桌面端左侧粘性导航栏，移动端底部浮动按钮 + 抽屉。
	4. [2026-10-05] 列表客观渲染 markdown（与详情同源），高度设上限，
	   超出则引导到详情页查看全文（EventBody 的限高逻辑）。
	5. [2026-10-05] 不渲染头像与名字（Owner 单人站点，冗余）。
-->
<script lang="ts">
  import { contentQuery } from '$lib/content-pipeline/query.svelte'
  import type { ContentEntry } from '$lib/content-pipeline/types'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { OWNER } from '$lib/github/client'
  import { authStore } from '$lib/auth/session.svelte'
  import NewContentDialog from './NewContentDialog.svelte'
  import EventBody from './EventBody.svelte'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import { Button } from '$lib/components/ui/button'
  import MessageSquareIcon from '@lucide/svelte/icons/message-square'
  import CalendarIcon from '@lucide/svelte/icons/calendar'
  import ArrowUpRightIcon from '@lucide/svelte/icons/arrow-up-right'
  import PlusIcon from '@lucide/svelte/icons/plus'
  import TimelineIcon from '@lucide/svelte/icons/history'

  import '$lib/styles/x-archive.css'

  const isOwner = $derived(
    !!authStore.state.user && authStore.state.user.login.toLowerCase() === OWNER.toLowerCase(),
  )
  let newDialogOpen = $state(false)

  /** 新建事件确认：跳 GithubEditorApp 编辑新文件。 */
  function handleCreated(path: string): void {
    newDialogOpen = false
    navController.navigateMain(`/app/github-editor/repo/gaubee/gaubee.com?file=${encodeURIComponent(path)}`)
  }

  // contentQuery 已在 AppManager.init() 投影内容管道后初始化（同步内存读取）
  const events = $derived.by<ContentEntry[]>(() => {
    void contentQuery.version
    return contentQuery.listEvents()
  })
  const loading = $derived(!contentQuery.initialized)

  const monthKeyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  const monthLabel = (key: string) => {
    const [y, m] = key.split('-')
    return `${y}年${Number(m)}月`
  }

  /** 有数据的月份（降序）——时间轴导航只显示这些。 */
  const months = $derived.by(() => {
    const map = new Map<string, number>()
    for (const e of events) {
      const key = monthKeyOf(e.date)
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  })

  /** 年 → 月份组（导航按年分层）。 */
  const years = $derived.by(() => {
    const map = new Map<string, { key: string; count: number }[]>()
    for (const [key, count] of months) {
      const y = key.slice(0, 4)
      const list = map.get(y) ?? []
      list.push({ key, count })
      map.set(y, list)
    }
    return [...map.entries()]
  })

  let selectedMonth = $state('')
  const currentMonth = $derived(selectedMonth || months[0]?.[0] || '')
  const visible = $derived(events.filter((e) => monthKeyOf(e.date) === currentMonth))
  let sheetOpen = $state(false)

  function pickMonth(key: string): void {
    selectedMonth = key
    sheetOpen = false
    // 切月重置滚动量（kzf 裁决 17）：新列表从头读
    requestAnimationFrame(() => {
      document.scrollingElement?.scrollTo({ top: 0 })
      window.scrollTo({ top: 0 })
    })
  }

  function hrefFor(entry: ContentEntry): string {
    return `/article/${entry.collection}/${entry.id.stem}`
  }

  function openEvent(event: MouseEvent, entry: ContentEntry): void {
    event.preventDefault()
    navController.navigateMain(hrefFor(entry))
  }

  function titleFor(entry: ContentEntry): string {
    return entry.metadata.title ?? entry.id.slug ?? '查看事件详情'
  }

  function formatDate(date: Date): string {
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
  }
</script>

<div class="mx-auto max-w-5xl px-4 py-8 sm:px-6">
  <header class="mb-6 flex items-center gap-3">
    <div class="flex size-10 items-center justify-center rounded-lg bg-primary/10">
      <MessageSquareIcon class="text-primary size-5" />
    </div>
    <div class="min-w-0">
      <h1 class="text-2xl font-bold">事件</h1>
      <p class="text-muted-foreground truncate text-sm">
        共 {events.length} 条事件{months.length ? ` · ${monthLabel(currentMonth)} ${visible.length} 条` : ''}
      </p>
    </div>
    {#if isOwner}
      <Button size="sm" variant="outline" class="ml-auto" onclick={() => (newDialogOpen = true)}>
        <PlusIcon class="size-4" />
        <span class="hidden sm:inline">新建事件</span>
      </Button>
    {/if}
  </header>

  {#if loading}
    <div class="divide-y divide-border">
      {#each Array(5) as _, index (index)}
        <div class="flex gap-3 py-5" aria-label="正在加载事件">
          <div class="flex-1 space-y-2">
            <Skeleton class="h-4 w-1/4" />
            <Skeleton class="h-4 w-full" />
            <Skeleton class="h-4 w-3/4" />
          </div>
        </div>
      {/each}
    </div>
  {:else if events.length === 0}
    <div class="flex flex-col items-center py-20 text-center">
      <div class="mb-4 flex size-16 items-center justify-center rounded-full bg-muted">
        <MessageSquareIcon class="text-muted-foreground size-8" />
      </div>
      <h2 class="mb-1 text-lg font-medium">暂无事件</h2>
      <p class="text-muted-foreground text-sm">还没有发布任何事件</p>
    </div>
  {:else}
    <div class="lg:flex lg:gap-8">
      <!-- 桌面：时间轴导航栏 -->
      <aside class="hidden w-44 shrink-0 lg:block" aria-label="时间轴导航">
        <nav class="sticky top-4 max-h-[72vh] overflow-y-auto pr-1">
          {#each years as [year, list] (year)}
            <div class="text-muted-foreground mt-3 mb-1 text-xs font-semibold first:mt-0">{year}</div>
            {#each list as m (m.key)}
              <button
                type="button"
                class="event-nav-item mb-0.5 flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-sm transition-colors {m.key === currentMonth
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'}"
                onclick={() => pickMonth(m.key)}
              >
                <span>{monthLabel(m.key).slice(5)}</span>
                <span class="text-xs tabular-nums {m.key === currentMonth ? 'opacity-100' : 'opacity-70'}">{m.count}</span>
              </button>
            {/each}
          {/each}
        </nav>
      </aside>

      <!-- 当前月份的事件（移动端预留浮动按钮空间） -->
      <div class="min-w-0 flex-1 pb-28 lg:pb-0">
        {#each visible as entry (entry.path)}
          <article class="border-border border-b py-5">
            <div class="event-item-head text-sm sticky top-0 z-10 -mx-1 mb-2 flex min-w-0 items-center gap-2 bg-background px-1 py-1.5">
              <a
                class="text-muted-foreground inline-flex shrink-0 items-center gap-1 hover:underline"
                href={hrefFor(entry)}
                aria-label={`${titleFor(entry)}，发布于 ${formatDate(entry.date)}`}
                onclick={(event) => openEvent(event, entry)}
              >
                <CalendarIcon class="size-3" />
                <time>{formatDate(entry.date)}</time>
              </a>
              <span class="text-muted-foreground truncate text-xs">{titleFor(entry)}</span>
              <a
                class="text-muted-foreground ml-auto inline-flex shrink-0 items-center gap-1 hover:text-foreground"
                href={hrefFor(entry)}
                onclick={(event) => openEvent(event, entry)}
              >
                详情
                <ArrowUpRightIcon class="size-3.5" />
              </a>
            </div>
            <EventBody body={entry.body} />
          </article>
        {/each}
      </div>
    </div>
  {/if}
</div>

<!-- 移动：浮动导航按钮 + 底部抽屉 -->
{#if months.length > 1}
  <button
    type="button"
    class="bg-primary text-primary-foreground fixed right-5 bottom-24 z-40 inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium shadow-lg lg:hidden"
    onclick={() => (sheetOpen = true)}
  >
    <TimelineIcon class="size-4" />
    {monthLabel(currentMonth)}
  </button>

  {#if sheetOpen}
    <div class="fixed inset-0 z-50 lg:hidden" role="dialog" aria-label="时间轴导航">
      <button
        type="button"
        class="absolute inset-0 bg-black/50"
        aria-label="关闭时间轴导航"
        onclick={() => (sheetOpen = false)}
      ></button>
      <div class="event-sheet bg-background absolute inset-x-0 bottom-0 max-h-[70vh] overflow-y-auto rounded-t-2xl border-t border-border p-4 pb-8">
        <div class="mx-auto mb-2 h-1 w-10 rounded-full bg-muted-foreground/40" aria-hidden="true"></div>
        {#each years as [year, list] (year)}
          <div class="text-muted-foreground mt-3 mb-1 text-xs font-semibold first:mt-0">{year}年</div>
          <div class="grid grid-cols-2 gap-1.5">
            {#each list as m (m.key)}
              <button
                type="button"
                class="flex items-center justify-between rounded-md border px-3 py-2 text-sm {m.key === currentMonth
                  ? 'border-primary/40 bg-primary/10 text-primary font-medium'
                  : 'border-border text-muted-foreground'}"
                onclick={() => pickMonth(m.key)}
              >
                <span>{monthLabel(m.key)}</span>
                <span class="text-xs tabular-nums opacity-70">{m.count}</span>
              </button>
            {/each}
          </div>
        {/each}
      </div>
    </div>
  {/if}
{/if}

{#if isOwner}
  <NewContentDialog collection="events" bind:open={newDialogOpen} oncreated={handleCreated} />
{/if}

<style>
  /* 移动抽屉入场动画（尊重系统减动效） */
  .event-sheet {
    animation: event-sheet-in 0.2s ease-out;
  }
  @keyframes event-sheet-in {
    from {
      transform: translateY(24px);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .event-sheet {
      animation: none;
    }
  }
</style>
