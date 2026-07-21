<!--
	ArticleDetailView：文章详情页（纯只读）。
	
	从 ReadonlyVFS 读取，无需登录即可阅读。
	支持上一篇/下一篇导航。
-->
<script lang="ts">
  import { readonlyVfs, type ReadonlyPost } from '$lib/vfs/readonly'
  import { navController } from '$lib/nav/nav-controller-instance'
  import MarkdownViewer from '$lib/markdown/MarkdownViewer.svelte'
  import { Badge } from '$lib/components/ui/badge'
  import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left'
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right'
  import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left'
  import CalendarIcon from '@lucide/svelte/icons/calendar'
  import ClockIcon from '@lucide/svelte/icons/clock'
  import TagIcon from '@lucide/svelte/icons/tag'

  interface Props {
    /** 路径：/article/{collection}/{stem} */
    pathname: string;
  }

  let { pathname }: Props = $props();

  /** 解析路径参数。 */
  const target = $derived.by(() => {
    const match = pathname.match(/^\/article\/(articles|events)\/(.+)$/)
    if (!match) return null
    return { collection: match[1] as 'articles' | 'events', stem: match[2] }
  })

  /** 当前文章。 */
  const post = $derived(
    target ? readonlyVfs.findPost(target.collection, target.stem) : undefined
  )

  /** 同集合所有文章（排序）。 */
  const siblings = $derived(
    target ? readonlyVfs.getPostsByCollection(target.collection) : []
  )

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

  function gotoPost(p: ReadonlyPost) {
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

<div class="mx-auto max-w-3xl">
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

    <!-- 文章头部 -->
    <header class="mb-8">
      <h1 class="mb-4 text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
        {post.metadata.title ?? post.id.slug ?? post.id.stem}
      </h1>

      <div class="text-muted-foreground flex flex-wrap items-center gap-4 text-sm">
        <div class="flex items-center gap-1.5">
          <CalendarIcon class="size-4" />
          <time>{formatDate(post.metadata.date)}</time>
        </div>

        {#if post.metadata.updated && post.metadata.updated.getTime() !== post.metadata.date.getTime()}
          <div class="flex items-center gap-1.5">
            <ClockIcon class="size-4" />
            <span>更新于 {formatDate(post.metadata.updated)}</span>
          </div>
        {/if}
      </div>

      {#if post.metadata.tags.length > 0}
        <div class="mt-4 flex flex-wrap items-center gap-2">
          <TagIcon class="text-muted-foreground size-4" />
          {#each post.metadata.tags as tag}
            <Badge variant="secondary" class="text-xs">{tag}</Badge>
          {/each}
        </div>
      {/if}
    </header>

    <!-- 正文 -->
    <article class="prose dark:prose-invert prose-zinc max-w-none">
      <MarkdownViewer markdown={post.body} />
    </article>

    <!-- 上一篇/下一篇 -->
    <nav class="mt-12 flex gap-4 border-t pt-6">
      {#if newer}
        <button
          class="hover:bg-accent/50 flex flex-1 flex-col items-start rounded-lg border p-4 text-left transition-colors"
          onclick={() => gotoPost(newer)}
        >
          <span class="text-muted-foreground mb-1 flex items-center gap-1 text-xs">
            <ChevronLeftIcon class="size-3" /> 上一篇
          </span>
          <span class="font-medium">
            {newer.metadata.title ?? newer.id.slug ?? newer.id.stem}
          </span>
        </button>
      {:else}
        <div class="flex-1" />
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
            {older.metadata.title ?? older.id.slug ?? older.id.stem}
          </span>
        </button>
      {:else}
        <div class="flex-1" />
      {/if}
    </nav>
  {/if}
</div>
