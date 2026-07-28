<!--
	正交意图：
	1. 原始需求（2026-07-21）：长文需要桌面和移动 TOC。
	2. 原始需求（2026-07-22）：桌面 TOC 位于右侧；拉伸的侧栏承载吸顶，内部目录独立滚动，避免与应用导航叠加在左侧。
	3. 从内容管道（contentQuery）阅读文章，并保持前后文章导航。
-->
<script lang="ts">
  import { contentQuery } from '$lib/content-pipeline/query.svelte'
  import type { ContentEntry } from '$lib/content-pipeline/types'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { useParams } from '$lib/router'
  import { OWNER } from '$lib/github/client'
  import { authStore } from '$lib/auth/session.svelte'
  import MarkdownViewer from '$lib/markdown/MarkdownViewer.svelte'
  import TocTree from './TocTree.svelte'
  import { Badge } from '$lib/components/ui/badge'
  import { Button } from '$lib/components/ui/button'
  import AIBadge from '$lib/components/ui/ai-badge/AIBadge.svelte'
  import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left'
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right'
  import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left'
  import CalendarIcon from '@lucide/svelte/icons/calendar'
  import ClockIcon from '@lucide/svelte/icons/clock'
  import TagIcon from '@lucide/svelte/icons/tag'
  import SquarePenIcon from '@lucide/svelte/icons/square-pen'

  /** 当前登录用户是否为仓库本人（显示编辑入口）。 */
  const isOwner = $derived(
    !!authStore.state.user && authStore.state.user.login.toLowerCase() === OWNER.toLowerCase(),
  )

  /** 跳 GithubEditorApp 编辑当前文章。 */
  function handleEdit(): void {
    if (!target) return
    const path = `src/content/${target.collection}/${target.stem}.md`
    navController.navigateMain(`/app/github-editor/repo/gaubee/gaubee.com?file=${encodeURIComponent(path)}`)
  }

  interface Props {}

  let {}: Props = $props();

  /** 正文容器（bind:this，传给 TocTree 作为 ScrollSpy 的 container）。 */
  let articleContentEl: HTMLElement | undefined = $state();

  /** 从 router context 拿到 parse 后的 collection/stem（类型安全，zod 已校验）。
   *  useParams 返回 getter，需 $derived 包装才能响应 URL 变化。 */
  type ArticleDetailParams = { collection: 'articles' | 'events'; stem: string };
  const getParams = useParams<ArticleDetailParams>();

  /** 解析路径参数。 */
  const target = $derived.by(() => {
    const p = getParams?.()
    if (!p) return null
    return { collection: p.collection, stem: p.stem }
  })

  /** 当前文章。 */
  const post = $derived.by<ContentEntry | null>(() => {
    void contentQuery.version
    if (!target) return null
    return contentQuery.findPost(target.collection, target.stem)
  })

  /** 同集合所有文章（按 date 降序）。 */
  const siblings = $derived.by<ContentEntry[]>(() => {
    void contentQuery.version
    return target ? contentQuery.siblings(target.collection) : []
  })

  /** 当前索引。 */
  const currentIndex = $derived(
    post ? siblings.findIndex((p) => p.id.stem === post.id.stem) : -1
  )

  /** 上一篇（更新的）。 */
  const newer = $derived(currentIndex > 0 ? siblings[currentIndex - 1] : null)
  /** 下一篇（更旧的）。 */
  const older = $derived(
    currentIndex >= 0 && currentIndex < siblings.length - 1
      ? siblings[currentIndex + 1]
      : null
  )

  function formatDate(d: Date): string {
    return d.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }

  function gotoPost(p: ContentEntry) {
    navController.navigateMain(`/article/${p.collection}/${p.id.stem}`)
  }

  function backToList() {
    if (target?.collection === 'events') {
      navController.navigateMain('/app/shout')
    } else {
      navController.navigateMain('/app/articles')
    }
  }
</script>

<div class="mx-auto max-w-[78rem] px-4 py-6 sm:px-6 lg:px-8">
  {#if !target || !post}
    <div class="flex h-64 items-center justify-center">
      <p class="text-muted-foreground text-sm">文章未找到</p>
    </div>
  {:else}
    <!-- 返回按钮 -->
    <button
      class="text-muted-foreground hover:text-foreground mb-6 flex items-center gap-1.5 text-sm transition-colors"
      onclick={backToList}
    >
      <ArrowLeftIcon class="size-4" />
      <span>返回{post.collection === 'events' ? '说说' : '文章'}列表</span>
    </button>

    <div class="xl:grid xl:grid-cols-[minmax(0,72ch)_14rem] xl:justify-center xl:gap-x-10">
      <!-- 主内容区：控制行宽，避免宽屏阅读时单行过长。 -->
      <div class="min-w-0">
        <!-- 文章头部 -->
        <header class="mb-8">
          <div class="mb-4 flex items-start gap-3">
            <h1 class="min-w-0 flex-1 text-balance text-3xl font-bold leading-tight sm:text-4xl">
              {post.title}
            </h1>
            {#if isOwner}
              <Button size="sm" variant="outline" class="shrink-0" onclick={handleEdit}>
                <SquarePenIcon class="size-4" />
                <span class="hidden sm:inline">编辑</span>
              </Button>
            {/if}
          </div>

          <div class="text-muted-foreground flex flex-wrap items-center gap-4 text-sm">
            <div class="flex items-center gap-1.5">
              <CalendarIcon class="size-4" />
              <time>{formatDate(post.date)}</time>
            </div>

            {#if post.updated && post.updated.getTime() !== post.date.getTime()}
              <div class="flex items-center gap-1.5">
                <ClockIcon class="size-4" />
                <span>更新于 {formatDate(post.updated)}</span>
              </div>
            {/if}
          </div>

          {#if post.tags.length > 0}
            <div class="mt-4 flex flex-wrap items-center gap-2">
              <TagIcon class="text-muted-foreground size-4" />
              {#each post.tags as tag}
                <Badge variant="secondary" class="text-xs">{tag}</Badge>
              {/each}
            </div>
          {/if}
          {#if post.metadata.ai && post.metadata.ai.length > 0}
            <div class="mt-3 flex flex-wrap items-center gap-2">
              <AIBadge ai={post.metadata.ai} />
            </div>
          {/if}
        </header>

        <!-- 正文：bind this 给 TocTree 用作 ScrollSpy 的 container -->
        <article bind:this={articleContentEl} class="article-content prose dark:prose-invert prose-zinc max-w-none">
          <MarkdownViewer markdown={post.body} />
        </article>

        <!-- 上一篇/下一篇 -->
        <nav class="mt-12 flex gap-4 border-t pt-6" aria-label="文章导航">
          {#if newer}
            <button
              class="hover:bg-accent/50 flex flex-1 flex-col items-start rounded-lg border p-4 text-left transition-colors"
              onclick={() => gotoPost(newer)}
            >
              <span class="text-muted-foreground mb-1 flex items-center gap-1 text-xs">
                <ChevronLeftIcon class="size-3" /> 上一篇
              </span>
              <span class="font-medium">
                {newer.title}
              </span>
            </button>
          {:else}
            <div class="flex-1"></div>
          {/if}

          {#if older}
            <button
              class="hover:bg-accent/50 flex flex-1 flex-col items-end rounded-lg border p-4 text-right transition-colors"
              onclick={() => gotoPost(older)}
            >
              <span class="text-muted-foreground mb-1 flex items-center gap-1 text-xs">
                下一篇 <ChevronRightIcon class="size-3" />
              </span>
              <span class="font-medium">
                {older.title}
              </span>
            </button>
          {:else}
            <div class="flex-1"></div>
          {/if}
        </nav>
      </div>

      <!-- 桌面端 TOC：全局应用导航在左，文章导航固定在右。 -->
      <aside class="hidden xl:block">
        <TocTree markdown={post.body} contentEl={articleContentEl} />
      </aside>
    </div>

    <!-- 移动端 TOC（浮动按钮 + Sheet） -->
    <div class="xl:hidden">
      <TocTree markdown={post.body} contentEl={articleContentEl} />
    </div>
  {/if}
</div>

<style>
  .article-content :global(h2[id]),
  .article-content :global(h3[id]) {
    scroll-margin-top: 5rem;
  }
</style>
