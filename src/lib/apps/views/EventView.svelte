<!--
	EventView：gaubeeOS「事件」应用工作区（2026-10-09 三段布局改造，kzf 裁决 1+2 与移动端）。

	正交意图：
	1. 原始需求（2026-07-21）：列表正确渲染 Markdown（时间线式阅读）。
	2. 从内容管道（contentQuery）按时间倒序读取 events。
	3. URL 承载状态（裁决 1）：?month=YYYY-MM（必显式，缺失/非法时规范化为最新月并 REPLACE
	   回写）+ ?item=<stem>（可选，选中条目）。刷新/分享/前进后退完整还原；选 search 而非
	   路径段是因 ActivityRouter 按 route id 保活组件，同 route 仅 search 变化时中段列表
	   DOM 与滚动位置不销毁。旧 /article/events/<stem> 深链不受影响（独立路由继续渲染）。
	4. 三段布局（裁决 2，2026-10-10 kzf 纠偏定稿，桌面 >=1024px）：左「月份」（年分层时间轴）
	   + 中「events-title」（当月事件标题列表，选中高亮）+ 右「events-list」（选中事件的
	   EventBody 内容列表，作者浮卡挂正文容器）。eventDetail（/article/events/<stem>）仍是
	   独立页面，不内嵌工作区——入口在段 3 头部「详情页 ↗」与段 2 行内「详情 ↗」。三段各自
	   独立滚动（段级 overflow-auto，滚动重置走真实滚动祖先）。
	5. 移动端（<1024px）单段钻取：月份折叠为顶部横向 chips，点标题推入全屏内容列表（带返回），
	   列表不卸载（后退滚动位置保留）。
	6. [2026-10-05] 列表客观渲染 markdown（与详情同源）。
	7. [2026-10-05] 不渲染头像与名字（Owner 单人站点，冗余）。
-->
<script lang="ts">
  import { contentQuery } from '$lib/content-pipeline/query.svelte'
  import type { ContentEntry } from '$lib/content-pipeline/types'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { useRoute, useSearch } from '$lib/router'
  import { OWNER } from '$lib/github/client'
  import { authStore } from '$lib/auth/session.svelte'
  import NewContentDialog from './NewContentDialog.svelte'
  import EventBody from './EventBody.svelte'
  import { authorHoverCard } from './author-hover-card'
  import { resetScrollFrom } from '$lib/utils/scroll'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import { Button } from '$lib/components/ui/button'
  import MessageSquareIcon from '@lucide/svelte/icons/message-square'
  import CalendarIcon from '@lucide/svelte/icons/calendar'
  import ArrowUpRightIcon from '@lucide/svelte/icons/arrow-up-right'
  import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left'
  import PlusIcon from '@lucide/svelte/icons/plus'

  import '$lib/styles/x-archive.css'

  /** search schema 与 builtin/event.ts 的 leafRoute 声明同形（?month=&item=）。 */
  type EventSearch = { month?: string; item?: string }
  const getSearch = useSearch<EventSearch>()
  const getRoute = useRoute()

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

  /** 当前 activity 的绝对基路径（/app/event；旧别名场景为 /app/shout），URL 拼接用。 */
  const basePath = $derived(getRoute?.()?.absolutePattern || '/app/event')

  /** URL 状态（zod 已 parse；缺省为空串）。 */
  const urlMonth = $derived(getSearch?.()?.month ?? '')
  const urlItem = $derived(getSearch?.()?.item ?? '')

  /** 生效月份：URL 合法月份优先，否则回落最新月份（URL 由规范化 effect 回写）。 */
  const currentMonth = $derived.by(() => {
    if (urlMonth && months.some(([k]) => k === urlMonth)) return urlMonth
    return months[0]?.[0] ?? ''
  })
  const visible = $derived(events.filter((e) => monthKeyOf(e.date) === currentMonth))

  /** 选中条目（全局按 stem 反查，容错月参错位——同步 effect 会把月参修正为条目所在月）。 */
  const detailPost = $derived.by<ContentEntry | null>(() => {
    void contentQuery.version
    if (!urlItem) return null
    return contentQuery.findPost('events', urlItem)
  })

  type UrlState = { month?: string; item?: string }

  /** 工作区导航（统一走当前 activity 基路径 + search，编码由 URLSearchParams 承担）。 */
  function go(state: UrlState, action: 'PUSH' | 'REPLACE' = 'PUSH'): void {
    const params = new URLSearchParams()
    if (state.month) params.set('month', state.month)
    if (state.item) params.set('item', state.item)
    const qs = params.toString()
    navController.navigateMain(`${basePath}${qs ? `?${qs}` : ''}`, action)
  }

  // 规范化 1（月份必显式）：URL 无月份或非法月份 → REPLACE 为最新月份（保留 item 让同步修正）
  $effect(() => {
    if (!contentQuery.initialized || months.length === 0) return
    if (urlMonth && months.some(([k]) => k === urlMonth)) return
    go({ month: months[0][0], item: urlItem || undefined }, 'REPLACE')
  })

  // 规范化 2（条目定位）：深链 item 与月参错位时，以条目所在月份修正（列表同步定位）
  $effect(() => {
    if (!contentQuery.initialized || !urlItem || !detailPost) return
    const m = monthKeyOf(detailPost.date)
    if (m !== currentMonth) go({ month: m, item: detailPost.id.stem }, 'REPLACE')
  })

  /** 列表滚动容器（滚动重置的遍历起点；真实滚动容器是段级 overflow-auto）。 */
  let listPaneEl = $state<HTMLElement | undefined>()
  /** 详情正文容器（ArticleDetailContent bind，滚动重置起点）。 */
  let detailContentEl = $state<HTMLElement | undefined>()
  /** 移动端月份 chips 行（激活 chip 自动滚入视野）。 */
  let chipsEl = $state<HTMLElement | undefined>()
  /** 桌面月份时间轴（深链还原时激活月滚入视野，2026-10-09 vision 验收补）。 */
  let railEl = $state<HTMLElement | undefined>()

  /** 切月重置列表滚动（$effect 在 DOM 更新后执行）。 */
  $effect(() => {
    void currentMonth
    resetScrollFrom(listPaneEl)
  })

  /** 换条目重置详情滚动（中段列表滚动不受影响——后退时列表位置保留）。 */
  $effect(() => {
    void urlItem
    resetScrollFrom(detailContentEl)
  })

  // 激活月份滚入视野（移动 chips 横向居中；桌面时间轴纵向定位——深链直达时
  // 目标月在 115 个月的深处，仅高亮不可见）
  $effect(() => {
    void currentMonth
    chipsEl?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' })
    railEl?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  })

  function pickMonth(key: string): void {
    go({ month: key })
  }

  function workspaceHref(entry: ContentEntry): string {
    const params = new URLSearchParams({ month: monthKeyOf(entry.date), item: entry.id.stem })
    return `${basePath}?${params.toString()}`
  }

  /** 条目卡片整卡点击（事件委托）：内部 a/button/label/媒体控件自行处理。 */
  function openItem(event: MouseEvent, entry: ContentEntry): void {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const t = event.target as HTMLElement | null
    if (t?.closest('a, button, input, label, video, audio')) return
    go({ month: monthKeyOf(entry.date), item: entry.id.stem })
  }

  /** 卡片内标题/日期锚：拦截默认整页跳转走 SPA（修饰键放行新标签 fallback）。 */
  function openItemFromLink(event: MouseEvent, entry: ContentEntry): void {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    go({ month: monthKeyOf(entry.date), item: entry.id.stem })
  }

  /** 键盘可达：标题锚天然支持 Enter；卡片 Enter/Space 亦推详情。 */
  function openItemByKey(event: KeyboardEvent, entry: ContentEntry): void {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const t = event.target as HTMLElement | null
    if (t?.closest('a, button')) return
    event.preventDefault()
    go({ month: monthKeyOf(entry.date), item: entry.id.stem })
  }

  /** 移动端详情返回列表（留在当月，条目出栈）。 */
  function backToList(): void {
    go({ month: currentMonth || undefined })
  }

  function titleFor(entry: ContentEntry): string {
    return entry.title || entry.id.slug
  }

  function formatDate(date: Date): string {
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
  }
</script>

<div class="flex h-full min-h-0 flex-col">
  <!-- 顶栏：标题 + 计数 + 新建（三段共用，始终可见） -->
  <header class="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3 sm:px-6">
    <div class="flex size-9 items-center justify-center rounded-lg bg-primary/10">
      <MessageSquareIcon class="text-primary size-5" />
    </div>
    <div class="min-w-0">
      <h1 class="text-lg font-bold leading-tight">事件</h1>
      <p class="text-muted-foreground truncate text-xs">
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

  <!-- 三段容器：relative 承载移动端详情全屏推入（absolute inset-0） -->
  <div class="relative flex min-h-0 flex-1">
    {#if loading}
      <div class="min-w-0 flex-1 divide-y divide-border px-4 py-2 sm:px-6">
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
      <div class="flex min-w-0 flex-1 flex-col items-center justify-center py-20 text-center">
        <div class="mb-4 flex size-16 items-center justify-center rounded-full bg-muted">
          <MessageSquareIcon class="text-muted-foreground size-8" />
        </div>
        <h2 class="mb-1 text-lg font-medium">暂无事件</h2>
        <p class="text-muted-foreground text-sm">还没有发布任何事件</p>
      </div>
    {:else}
      <!-- 段 1：月份时间轴（桌面，年分层，仅有数据月份） -->
      <aside bind:this={railEl} class="hidden w-44 shrink-0 overflow-y-auto border-r border-border p-3 lg:block" aria-label="时间轴导航">
        {#each years as [year, list] (year)}
          <div class="text-muted-foreground mt-3 mb-1 text-xs font-semibold first:mt-0">{year}</div>
          {#each list as m (m.key)}
            <button
              type="button"
              data-active={m.key === currentMonth}
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
      </aside>

      <!-- 段 2：条目列表（桌面中段 / 移动端默认视图；详情推入时不卸载，滚动位置保留） -->
      <!-- 段 2 events-title：当月事件标题列表（kzf 2026-10-10：本质是 ToC，定窄不占宽；
           桌面固定 w-80，移动端保持全宽作默认视图） -->
      <section class="flex min-h-0 min-w-0 flex-1 flex-col lg:w-80 lg:flex-none" aria-label="事件列表">
        <!-- 移动端月份 chips（横向滚动，激活项居中） -->
        <div class="shrink-0 border-b border-border lg:hidden">
          <div bind:this={chipsEl} class="event-chips flex gap-1.5 overflow-x-auto px-3 py-2" role="group" aria-label="月份切换">
            {#each months as m (m[0])}
              <button
                type="button"
                data-active={m[0] === currentMonth}
                class="shrink-0 rounded-full border px-3 py-1 text-xs transition-colors {m[0] === currentMonth
                  ? 'border-primary/40 bg-primary/10 text-primary font-medium'
                  : 'border-border text-muted-foreground'}"
                onclick={() => pickMonth(m[0])}
              >
                {monthLabel(m[0])}
                <span class="tabular-nums opacity-70">{m[1]}</span>
              </button>
            {/each}
          </div>
        </div>

        <!-- 段 2 events-title：当月事件标题列表（纯标题+日期；正文在段 3 events-list） -->
        <div bind:this={listPaneEl} class="min-h-0 flex-1 overflow-y-auto">
          <div class="mx-auto max-w-3xl">
            {#if visible.length === 0}
              <div class="text-muted-foreground px-4 py-16 text-center text-sm">
                {currentMonth ? `${monthLabel(currentMonth)} 暂无事件` : '暂无事件'}
              </div>
            {/if}
            {#each visible as entry (entry.path)}
              <!-- svelte-ignore a11y_no_noninteractive_element_interactions a11y_click_events_have_key_events -->
              <!-- 整行点击选中（段 3 出内容列表）；键盘路径由行内标题/日期锚（真 <a>）承担；
                   「详情 ↗」锚不通 SPA，直达独立详情页 /article/events/<stem> -->
              <article
                class="border-border cursor-pointer border-b px-4 py-3.5 transition-colors sm:px-6 {urlItem === entry.id.stem
                  ? 'bg-primary/5'
                  : 'hover:bg-muted/40'}"
                onclick={(e) => openItem(e, entry)}
                onkeydown={(e) => openItemByKey(e, entry)}
              >
                <div class="event-item-head flex min-w-0 items-center gap-2 text-sm">
                  <a
                    class="text-muted-foreground inline-flex shrink-0 items-center gap-1 hover:underline"
                    href={workspaceHref(entry)}
                    aria-label={`${titleFor(entry)}，发布于 ${formatDate(entry.date)}`}
                    onclick={(e) => openItemFromLink(e, entry)}
                  >
                    <CalendarIcon class="size-3" />
                    <time>{formatDate(entry.date)}</time>
                  </a>
                  <a
                    class="truncate hover:text-foreground hover:underline"
                    href={workspaceHref(entry)}
                    onclick={(e) => openItemFromLink(e, entry)}
                  >
                    {titleFor(entry)}
                  </a>
                  <a
                    class="text-muted-foreground ml-auto inline-flex shrink-0 items-center gap-1 hover:text-foreground"
                    href="/article/events/{entry.id.stem}"
                    aria-label={`打开 ${titleFor(entry)} 独立详情页`}
                  >
                    详情
                    <ArrowUpRightIcon class="size-3.5" />
                  </a>
                </div>
              </article>
            {/each}
          </div>
        </div>
      </section>

      <!-- 段 3 events-list：选中事件的内容列表（EventBody 全文渲染；kzf 2026-10-10 纠偏：
           eventDetail 不内嵌工作区，独立页面经「详情页 ↗」直达。移动端推入全屏——选中时
           absolute 覆盖，lg 恢复 static） -->
      <section
        class="min-h-0 min-w-0 flex-1 overflow-y-auto border-border {urlItem
          ? 'absolute inset-0 z-20 flex bg-background'
          : 'hidden'} lg:static lg:block lg:border-l"
        aria-label="事件内容"
      >
        {#if detailPost}
          <div class="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
            <!-- 移动端返回列表（桌面由列表点击切换，无需返回钮） -->
            <button
              class="text-muted-foreground hover:text-foreground mb-6 flex items-center gap-1.5 text-sm transition-colors lg:hidden"
              onclick={backToList}
            >
              <ArrowLeftIcon class="size-4" />
              <span>返回{monthLabel(currentMonth)}列表</span>
            </button>
            <header class="mb-4 flex min-w-0 items-center gap-3">
              <div class="min-w-0 flex-1">
                <h2 class="truncate text-base font-bold">{titleFor(detailPost)}</h2>
                <p class="text-muted-foreground mt-0.5 text-xs">{formatDate(detailPost.date)}</p>
              </div>
              <a
                class="text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center gap-1 text-xs hover:underline"
                href="/article/events/{detailPost.id.stem}"
                aria-label={`打开 ${titleFor(detailPost)} 独立详情页`}
              >
                详情页
                <ArrowUpRightIcon class="size-3.5" />
              </a>
            </header>
            <!-- 浮卡挂正文容器：events-list 里的 @作者名 hover 出卡；xvideo/xhighlight/
                 mediasrc 由 EventBody 自带 -->
            <div bind:this={detailContentEl} use:authorHoverCard>
              <EventBody body={detailPost.body} />
            </div>
          </div>
        {:else if urlItem}
          <div class="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
            <p class="text-muted-foreground text-sm">未找到该事件（可能已被删除）</p>
            <Button size="sm" variant="outline" onclick={backToList}>返回列表</Button>
          </div>
        {:else}
          <!-- 桌面空态：未选中条目 -->
          <div class="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
            <div class="flex size-14 items-center justify-center rounded-full bg-muted">
              <MessageSquareIcon class="text-muted-foreground/60 size-7" />
            </div>
            <p class="text-muted-foreground text-sm">从中间选择一条事件查看内容</p>
          </div>
        {/if}
      </section>
    {/if}
  </div>
</div>

{#if isOwner}
  <NewContentDialog collection="events" bind:open={newDialogOpen} oncreated={handleCreated} />
{/if}
