<!--
	正交意图：
	1. 原始需求（2026-07-21）：文章列表需要按年份 TOC，移动端也必须有项目。
	2. 原始需求（2026-07-22）：宽桌面将年份 TOC 放在列表右侧；拉伸的侧栏承载吸顶，内部目录独立滚动。
	3. 从内容管道（contentQuery）读取并按发布时间分组展示文章。
-->
<script lang="ts">
  import { contentQuery } from '$lib/content-pipeline/query.svelte'
  import type { ContentEntry } from '$lib/content-pipeline/types'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { OWNER } from '$lib/github/client'
  import { authStore } from '$lib/auth/session.svelte'
  import YearToc from './YearToc.svelte'
  import NewContentDialog from './NewContentDialog.svelte'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import { Badge } from '$lib/components/ui/badge'
  import { Button } from '$lib/components/ui/button'
  import AIBadge from '$lib/components/ui/ai-badge/AIBadge.svelte'
  import {
    createPrefixedSectionDetector,
    createScrollSpy,
    findScrollParent,
    type HighlightMap,
  } from '$lib/components/toc/scroll-spy.dom'
  import { browser } from '$app/environment'
  import FileTextIcon from '@lucide/svelte/icons/file-text'
  import CalendarIcon from '@lucide/svelte/icons/calendar'
  import ArrowRightIcon from '@lucide/svelte/icons/arrow-right'
  import PlusIcon from '@lucide/svelte/icons/plus'

  /** 当前登录用户是否为仓库本人（显示编辑/新增入口）。 */
  const isOwner = $derived(
    !!authStore.state.user && authStore.state.user.login.toLowerCase() === OWNER.toLowerCase(),
  )
  let newDialogOpen = $state(false)

  /** 新建文章确认：跳 GithubEditorApp 编辑新文件。 */
  function handleCreated(path: string): void {
    newDialogOpen = false
    navController.navigateMain(`/app/github-editor/repo/gaubee/gaubee.com?file=${encodeURIComponent(path)}`)
  }

  // contentQuery 已在 AppManager.init() 投影内容管道后初始化（同步内存读取）
  // 依赖 version 触发响应式重算（编辑器写入后 refresh 自增）
  const posts = $derived.by<ContentEntry[]>(() => {
    void contentQuery.version
    return contentQuery.listArticles()
  })
  // 首帧骨架屏：管道尚未初始化时显示
  const loading = $derived(!contentQuery.initialized)
  let yearRefs = $state<Map<number, HTMLElement>>(new Map())

  /** 年份分组容器（包裹所有 section），bind:this 给 ScrollSpy。 */
  let yearListEl: HTMLElement | undefined = $state()
  /** ScrollSpy 高亮映射（key=`year-{year}`）。 */
  let yearHighlights = $state<HighlightMap>(new Map())

  // 年份分组 ScrollSpy：container=yearListEl，detector 识别 section#year-*
  $effect(() => {
    if (!browser || !yearListEl) return
    const viewport = findScrollParent(yearListEl)
    if (!viewport) return
    const handle = createScrollSpy({
      container: yearListEl,
      detector: createPrefixedSectionDetector('year-'),
      viewport,
      topOffset: 80,
      onUpdate: (m) => (yearHighlights = m),
    })
    return () => handle.destroy()
  })

  function formatDate(d: Date): string {
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
  }

  function navigateToArticle(post: ContentEntry) {
    navController.navigateMain(`/article/${post.collection}/${post.id.stem}`)
  }

  function scrollToYear(year: number) {
    const el = yearRefs.get(year)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  function yearAnchor(element: HTMLElement, year: number) {
    const next = new Map(yearRefs)
    next.set(year, element)
    yearRefs = next

    return {
      destroy() {
        const current = new Map(yearRefs)
        current.delete(year)
        yearRefs = current
      },
    }
  }

  const grouped = $derived(contentQuery.groupByYear(posts))
</script>

<div class="mx-auto max-w-[78rem] px-4 py-8 sm:px-6 lg:px-8">
  <div class="xl:grid xl:grid-cols-[minmax(0,44rem)_14rem] xl:justify-center xl:gap-x-10">
    <!-- 主内容区 -->
    <div class="min-w-0" data-article-list-content>
      <!-- 页面头部 -->
      <header class="mb-10">
        <div class="flex items-center gap-3 mb-2">
          <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <FileTextIcon class="text-primary size-5" />
          </div>
          <h1 class="text-balance text-3xl font-bold">文章</h1>
          {#if isOwner}
            <Button size="sm" variant="outline" class="ml-auto" onclick={() => (newDialogOpen = true)}>
              <PlusIcon class="size-4" />
              <span class="hidden sm:inline">新建文章</span>
            </Button>
          {/if}
        </div>
        <p class="text-muted-foreground text-sm ml-[52px]">
          共 {posts.length} 篇文章
        </p>
      </header>

      {#if loading}
        <!-- 骨架屏 -->
        <div class="space-y-4">
          {#each Array(5) as _, i}
            <div class="rounded-2xl border p-5 animate-pulse" style="animation-delay: {i * 100}ms">
              <Skeleton class="mb-3 h-6 w-3/4" />
              <Skeleton class="mb-4 h-4 w-1/3" />
              <Skeleton class="h-20 w-full" />
            </div>
          {/each}
        </div>
      {:else if posts.length === 0}
        <!-- 空状态 -->
        <div class="flex flex-col items-center justify-center py-20 text-center">
          <div class="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <FileTextIcon class="text-muted-foreground size-8" />
          </div>
          <h3 class="mb-1 text-lg font-medium">暂无文章</h3>
          <p class="text-muted-foreground text-sm">还没有发布任何文章</p>
        </div>
      {:else}
        <!-- 按年份分组的文章列表：bind this 给 ScrollSpy 作 container -->
        <div class="space-y-12" bind:this={yearListEl}>
          {#each [...grouped.entries()] as [year, yearPosts], yearIndex (year)}
            <section id="year-{year}" use:yearAnchor={year} aria-labelledby={`year-${year}`}>
              <!-- 年份标题 -->
              <div class="flex items-center gap-4 mb-6">
                <h2 id={`year-${year}`} class="text-balance text-2xl font-bold">{year}</h2>
                <div class="flex-1 h-px bg-border"></div>
                <span class="text-muted-foreground text-sm">{yearPosts.length} 篇</span>
              </div>

              <!-- 该年份的文章 -->
              <div class="space-y-4">
                {#each yearPosts as post, postIndex (post.path)}
                  <article
                    class="overflow-hidden rounded-2xl border transition-colors hover:border-primary/40 hover:bg-accent"
                    style="animation: fadeInUp 0.5s ease-out {(yearIndex * 5 + postIndex) * 0.05}s both;"
                  >
                    <a
                      class="group block p-5 sm:p-6"
                      href={`/article/${post.collection}/${post.id.stem}`}
                      onclick={(event) => {
                        event.preventDefault()
                        navigateToArticle(post)
                      }}
                    >
                      <!-- 日期 + 标签 -->
                      <div class="mb-3 flex flex-wrap items-center gap-2">
                        <div class="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <CalendarIcon class="size-3.5" />
                          <time>{formatDate(post.date)}</time>
                        </div>
                        {#if post.tags.length > 0}
                          <span class="text-muted-foreground">·</span>
                          <div class="flex flex-wrap gap-1">
                            {#each post.tags.slice(0, 3) as tag}
                              <Badge variant="secondary" class="text-[10px] px-1.5 py-0 h-5 font-normal">
                                {tag}
                              </Badge>
                            {/each}
                          </div>
                        {/if}
                        {#if post.metadata.ai && post.metadata.ai.length > 0}
                          <div class="flex flex-wrap gap-1">
                            <AIBadge ai={post.metadata.ai} size="xs" />
                          </div>
                        {/if}
                      </div>

                      <!-- 标题 -->
                      <h3 class="mb-2 text-xl font-semibold leading-snug tracking-tight group-hover:text-primary transition-colors">
                        {post.title}
                      </h3>

                      <!-- 摘要（统一管道产物） -->
                      <p class="text-muted-foreground text-sm leading-relaxed line-clamp-2 mb-4">
                        {post.excerpt}
                      </p>

                      <!-- 阅读更多 -->
                      <div class="flex items-center gap-1 text-sm font-medium text-primary opacity-0 translate-x-[-8px] transition-all duration-300 group-hover:opacity-100 group-hover:translate-x-0">
                        <span>阅读全文</span>
                        <ArrowRightIcon class="size-4" />
                      </div>
                    </a>
                  </article>
                {/each}
              </div>
            </section>
          {/each}
        </div>
      {/if}
    </div>

    <!-- 桌面端年份 TOC：全局应用导航在左，列表时间导航固定在右。 -->
    <aside class="hidden xl:block">
      {#if !loading && posts.length > 0}
        <YearToc posts={posts} onSelectYear={scrollToYear} highlights={yearHighlights} />
      {/if}
    </aside>
  </div>

  <!-- 移动端年份 TOC -->
  {#if !loading && posts.length > 0}
    <div class="xl:hidden">
      <YearToc posts={posts} onSelectYear={scrollToYear} />
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

{#if isOwner}
  <NewContentDialog collection="articles" bind:open={newDialogOpen} oncreated={handleCreated} />
{/if}
