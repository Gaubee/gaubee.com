<!--
	ArticleDetailContent：文章/事件详情的「头部 + 正文」共享渲染（2026-10-09 三段布局抽取）。

	消费方：
	- ArticleDetailView.svelte（/article/{collection}/{stem} 独立详情路由）
	- EventView.svelte（事件工作区第三段内嵌详情）

	职责边界：只渲染标题行（含编辑入口）/日期/更新时间/标签/AI 徽标与正文容器；
	TOC、上一篇/下一篇、返回按钮等「所在场景」的导航归各消费方自持。
	正文保留 xvideo/xhighlight 增强、mediasrc 地区路由重写、@作者 hover 浮卡代理；
	contentEl 用 $bindable 暴露（消费方做滚动重置 / ScrollSpy）。
-->
<script lang="ts">
  import type { ContentEntry } from '$lib/content-pipeline/types'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { OWNER } from '$lib/github/client'
  import { authStore } from '$lib/auth/session.svelte'
  import MarkdownViewer from '$lib/markdown/MarkdownViewer.svelte'
  import { xvideo } from '$lib/player/x-video'
  import { xhighlight } from '$lib/player/x-highlight'
  import { mediasrc } from '$lib/player/media-src'
  import { authorHoverCard } from './author-hover-card'
  import { Badge } from '$lib/components/ui/badge'
  import { Button } from '$lib/components/ui/button'
  import AIBadge from '$lib/components/ui/ai-badge/AIBadge.svelte'
  import CalendarIcon from '@lucide/svelte/icons/calendar'
  import ClockIcon from '@lucide/svelte/icons/clock'
  import TagIcon from '@lucide/svelte/icons/tag'
  import SquarePenIcon from '@lucide/svelte/icons/square-pen'

  // 事件内容自持样式（x-arch-* 卡片/视频 HUD/译文切换），谁渲染谁导入（样式自治裁决）
  import '$lib/styles/x-archive.css'
  // @作者 hover 浮卡（应用层样式，同族 x-archive 令牌）
  import '$lib/styles/author-hover-card.css'

  let {
    post,
    contentEl = $bindable(),
  }: {
    post: ContentEntry
    /** 正文容器（bind 双向：消费方用于滚动重置 / TocTree ScrollSpy）。 */
    contentEl?: HTMLElement
  } = $props()

  /** 当前登录用户是否为仓库本人（显示编辑入口）。 */
  const isOwner = $derived(
    !!authStore.state.user && authStore.state.user.login.toLowerCase() === OWNER.toLowerCase(),
  )

  /** 跳 GithubEditorApp 编辑当前文章。 */
  function handleEdit(): void {
    const path = `src/content/${post.collection}/${post.id.stem}.md`
    navController.navigateMain(`/app/github-editor/repo/gaubee/gaubee.com?file=${encodeURIComponent(path)}`)
  }

  function formatDate(d: Date): string {
    return d.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  }
</script>

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

  <!-- 正文：contentEl bind 给消费方（滚动重置 / TocTree ScrollSpy）；
       xvideo/xhighlight 增强（自动播放/单实例/手势、代码高亮）与列表同源；
       mediasrc 做媒体引用的地区路由重写（cdn-media Phase 2，geo 失败不重写）；
       authorHoverCard 代理 .x-arch-author 的 @作者浮卡（data-* 缺失时不浮卡） -->
  <article
    bind:this={contentEl}
    use:xvideo
    use:xhighlight
    use:mediasrc
    use:authorHoverCard
    data-syntax-theme="gaubee"
    class="article-content prose dark:prose-invert prose-zinc max-w-none"
  >
    <MarkdownViewer markdown={post.body} />
  </article>
</div>

<style>
  /* 锚点跳转让开吸顶头（正文容器在本组件，样式随组件走） */
  .article-content :global(h2[id]),
  .article-content :global(h3[id]) {
    scroll-margin-top: 5rem;
  }
</style>
