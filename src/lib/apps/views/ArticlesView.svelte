<!--
	正交意图：
	1. 原始需求（2026-07-21）：文章列表需要按年份 TOC，移动端也必须有项目。
	2. 从 ReadonlyVFS 读取并按发布时间分组展示文章。
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { readonlyVfs } from '$lib/vfs/readonly'
  import { navController } from '$lib/nav/nav-controller-instance'
  import YearToc from './YearToc.svelte'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import { Badge } from '$lib/components/ui/badge'
  import FileTextIcon from '@lucide/svelte/icons/file-text'
  import CalendarIcon from '@lucide/svelte/icons/calendar'
  import ArrowRightIcon from '@lucide/svelte/icons/arrow-right'
  import type { ReadonlyPost } from '$lib/vfs/readonly'

  let posts = $state<ReadonlyPost[]>([])
  let loading = $state(true)
  let yearRefs = $state<Map<number, HTMLElement>>(new Map())

  onMount(() => {
    const articles = readonlyVfs.getPostsByCollection('articles')
    posts = articles.sort((a, b) => b.metadata.date.getTime() - a.metadata.date.getTime())
    loading = false
  })

  function formatDate(d: Date): string {
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
  }

  function navigateToArticle(post: ReadonlyPost) {
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

  function groupByYear(posts: ReadonlyPost[]): Map<number, ReadonlyPost[]> {
    const groups = new Map<number, ReadonlyPost[]>()
    for (const post of posts) {
      const year = post.metadata.date.getFullYear()
      if (!groups.has(year)) groups.set(year, [])
      groups.get(year)!.push(post)
    }
    return new Map([...groups.entries()].sort((a, b) => b[0] - a[0]))
  }
</script>

<div class="mx-auto max-w-5xl">
  <div class="flex gap-8">
    <!-- 桌面端年份 TOC -->
    <aside class="hidden lg:block lg:w-64 shrink-0">
      {#if !loading && posts.length > 0}
        <YearToc posts={posts} onSelectYear={scrollToYear} />
      {/if}
    </aside>

    <!-- 主内容区 -->
    <div class="flex-1 min-w-0 px-4 py-8 sm:px-6">
      <!-- 页面头部 -->
      <header class="mb-10">
        <div class="flex items-center gap-3 mb-2">
          <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <FileTextIcon class="text-primary size-5" />
          </div>
          <h1 class="text-3xl font-bold tracking-tight">文章</h1>
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
        <!-- 按年份分组的文章列表 -->
        <div class="space-y-12">
          {#each [...groupByYear(posts).entries()] as [year, yearPosts], yearIndex (year)}
            <section use:yearAnchor={year} aria-labelledby={`year-${year}`}>
              <!-- 年份标题 -->
              <div class="flex items-center gap-4 mb-6">
                <h2 id={`year-${year}`} class="text-2xl font-bold tracking-tight">{year}</h2>
                <div class="flex-1 h-px bg-border"></div>
                <span class="text-muted-foreground text-sm">{yearPosts.length} 篇</span>
              </div>

              <!-- 该年份的文章 -->
              <div class="space-y-4">
                {#each yearPosts as post, postIndex (post.path)}
                  <article
                    class="overflow-hidden rounded-2xl border bg-card transition-colors hover:border-primary/30 hover:bg-accent/20"
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
                          <time>{formatDate(post.metadata.date)}</time>
                        </div>
                        {#if post.metadata.tags.length > 0}
                          <span class="text-muted-foreground">·</span>
                          <div class="flex flex-wrap gap-1">
                            {#each post.metadata.tags.slice(0, 3) as tag}
                              <Badge variant="secondary" class="text-[10px] px-1.5 py-0 h-5 font-normal">
                                {tag}
                              </Badge>
                            {/each}
                          </div>
                        {/if}
                      </div>

                      <!-- 标题 -->
                      <h3 class="mb-2 text-xl font-semibold leading-snug tracking-tight group-hover:text-primary transition-colors">
                        {post.metadata.title ?? post.id.slug ?? post.id.stem}
                      </h3>

                      <!-- 摘要 -->
                      <p class="text-muted-foreground text-sm leading-relaxed line-clamp-2 mb-4">
                        {post.body.slice(0, 200).replace(/^#+\s*.+\n?/m, '').trim()}
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
  </div>

  <!-- 移动端年份 TOC -->
  {#if !loading && posts.length > 0}
    <div class="lg:hidden">
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
