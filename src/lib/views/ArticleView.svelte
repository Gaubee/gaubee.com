<!--
	ArticleView：文章详情阅读页。
	- 路径 /article/{collection}/{stem} 解析文章
	- MarkdownViewer 渲染全文
	- 标题、日期、标签
	- 上一篇/下一篇导航（同集合按 date 排序）
	- 编辑按钮（跳转编辑器）
-->
<script lang="ts">
  import { contentStore } from '$lib/data/content.svelte'
  import { navStore } from '$lib/nav/nav.svelte'
  import { navController } from '$lib/nav/nav-controller-instance'
  import MarkdownViewer from '$lib/markdown/MarkdownViewer.svelte'
  import * as Card from '$lib/components/ui/card'
  import { Button } from '$lib/components/ui/button'
  import { Badge } from '$lib/components/ui/badge'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import PencilIcon from '@lucide/svelte/icons/pencil'
  import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left'
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right'

  const navState = $derived(navStore.current)

  const target = $derived.by(() => {
    const path = navState.mainLocation.pathname
    const match = path.match(/^\/article\/(articles|events)\/(.+)$/)
    if (!match) return null
    return { collection: match[1] as 'articles' | 'events', stem: match[2] }
  })

  const post = $derived(
    target ? contentStore.findPost(target.collection, target.stem) : undefined
  )

  // 同集合的文章列表（按 date 降序），用于上下篇
  const siblings = $derived(
    target ? (target.collection === 'articles' ? contentStore.articles : contentStore.events) : []
  )
  const currentIndex = $derived(post ? siblings.findIndex((p) => p.path === post.path) : -1)
  const newer = $derived(currentIndex > 0 ? siblings[currentIndex - 1] : null)
  const older = $derived(currentIndex >= 0 && currentIndex < siblings.length - 1 ? siblings[currentIndex + 1] : null)

  function formatDate(d: Date): string {
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
  }

  function goto(p: { collection: string; id: { stem: string } }) {
    navController.navigateMain(`/article/${p.collection}/${p.id.stem}`)
  }
</script>

<div class="mx-auto max-w-3xl p-4 sm:p-6">
  {#if !target}
    <p class="text-muted-foreground">未指定文章</p>
  {:else if !post}
    {#if contentStore.state.loading}
      <div class="space-y-3">
        <Skeleton class="h-8 w-2/3" />
        <Skeleton class="h-4 w-1/4" />
        <Skeleton class="h-4 w-full" />
        <Skeleton class="h-4 w-5/6" />
      </div>
    {:else}
      <Card.Root>
        <Card.Content class="pt-6">
          <p class="text-muted-foreground">文章未找到。可能需要刷新内容列表。</p>
          <Button variant="outline" size="sm" class="mt-3" onclick={() => contentStore.refresh()}>
            刷新内容
          </Button>
        </Card.Content>
      </Card.Root>
    {/if}
  {:else}
    <!-- 文章头部 -->
    <header class="mb-6">
      <div class="text-muted-foreground mb-2 flex items-center gap-2 text-xs">
        <span>{post.collection === 'articles' ? '文章' : '短评'}</span>
        <span>·</span>
        <time>{formatDate(post.metadata.date)}</time>
        {#if post.metadata.updated && post.metadata.updated.getTime() !== post.metadata.date.getTime()}
          <span>·</span>
          <span>更新于 {formatDate(post.metadata.updated)}</span>
        {/if}
      </div>
      <h1 class="mb-3 text-3xl font-bold">{post.metadata.title ?? post.id.slug ?? post.id.stem}</h1>
      {#if post.metadata.tags.length > 0}
        <div class="flex flex-wrap gap-1.5">
          {#each post.metadata.tags as tag}
            <Badge variant="secondary">{tag}</Badge>
          {/each}
        </div>
      {/if}
      <div class="mt-3 flex gap-2">
        <Button
          size="sm"
          variant="outline"
          onclick={() => navController.navigateMain(`/app/editor/${post.collection}/${post.id.stem}`)}
        >
          <PencilIcon data-icon="inline-start" />
          编辑
        </Button>
        <Button
          size="sm"
          variant="ghost"
          href={`/pages/article/${post.collection}/${post.id.stem}`}
          target="_blank"
        >
          公开预览
        </Button>
      </div>
    </header>

    <!-- 正文 -->
    <MarkdownViewer markdown={post.body} />

    <!-- 上一篇/下一篇 -->
    <nav class="mt-10 flex gap-3 border-t border-border pt-6">
      {#if older}
        <button
          class="hover:bg-accent flex-1 rounded-lg border p-3 text-left transition-colors"
          onclick={() => goto(older)}
        >
          <div class="text-muted-foreground flex items-center gap-1 text-xs">
            <ChevronLeftIcon class="size-3" /> 上一篇
          </div>
          <div class="mt-1 truncate font-medium">
            {older.metadata.title ?? older.id.slug ?? older.id.stem}
          </div>
        </button>
      {/if}
      {#if newer}
        <button
          class="hover:bg-accent flex-1 rounded-lg border p-3 text-right transition-colors"
          onclick={() => goto(newer)}
        >
          <div class="text-muted-foreground flex items-center justify-end gap-1 text-xs">
            下一篇 <ChevronRightIcon class="size-3" />
          </div>
          <div class="mt-1 truncate font-medium">
            {newer.metadata.title ?? newer.id.slug ?? newer.id.stem}
          </div>
        </button>
      {/if}
    </nav>
  {/if}
</div>
