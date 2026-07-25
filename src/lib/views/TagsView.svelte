<!--
	TagsView：标签页（深链接 /tags 和 /tags/{tag}）。
	- /tags（无标签）：标签云，显示所有标签 + 文章数，点击进筛选。
	- /tags/{tag}：显示带指定标签的所有文章。
-->
<script lang="ts">
  import { contentStore } from '$lib/data/content.svelte'
  import { navStore } from '$lib/nav/nav.svelte'
  import { navController } from '$lib/nav/nav-controller-instance'
  import * as Card from '$lib/components/ui/card'
  import { Badge } from '$lib/components/ui/badge'
  import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left'

  type TagCount = { tag: string; count: number }

  const navState = $derived(navStore.current)
  // /tags → 无标签（标签云）；/tags/{tag} → 筛选
  const tag = $derived.by(() => {
    const match = navState.mainLocation.pathname.match(/^\/tags\/(.+)$/)
    return match ? decodeURIComponent(match[1]) : ''
  })
  const isTagCloud = $derived(tag === '')

  // 标签云：统计所有文章/说说的标签频次
  const allTags = $derived.by<TagCount[]>(() => {
    const counts = new Map<string, number>()
    for (const p of contentStore.allPosts) {
      for (const t of p.metadata.tags ?? []) {
        counts.set(t, (counts.get(t) ?? 0) + 1)
      }
    }
    return [...counts.entries()]
      .map(([t, count]) => ({ tag: t, count }))
      .sort((a, b) => b.count - a.count)
  })

  // 筛选：带指定标签的文章
  const posts = $derived(
    tag ? contentStore.allPosts.filter((p) => p.metadata.tags.includes(tag)) : []
  )

  function formatDate(d: Date): string {
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
  }

  function back() {
    navController.navigateMain('/')
  }

  function selectTag(t: string) {
    navController.navigateMain(`/tags/${encodeURIComponent(t)}`)
  }

  // 按频次映射字号
  function tagClass(count: number): string {
    if (count >= 5) return 'text-base font-semibold'
    if (count >= 3) return 'text-sm'
    return 'text-xs opacity-80'
  }
</script>

<div class="mx-auto max-w-3xl p-4 sm:p-6">
  <!-- 返回按钮 -->
  <button
    class="text-muted-foreground hover:text-foreground mb-6 flex items-center gap-1.5 text-sm transition-colors"
    onclick={back}
  >
    <ArrowLeftIcon class="size-4" />
    <span>返回</span>
  </button>

  {#if isTagCloud}
    <!-- 标签云：所有标签 -->
    <h1 class="mb-4 text-2xl font-semibold">全部标签</h1>
    {#if allTags.length === 0}
      <Card.Root>
        <Card.Content class="text-muted-foreground pt-6">
          {contentStore.state.loaded ? '暂无标签' : '正在加载内容...'}
        </Card.Content>
      </Card.Root>
    {:else}
      <div class="flex flex-wrap gap-2">
        {#each allTags as { tag: t, count } (t)}
          <button
            class="bg-secondary text-secondary-foreground hover:bg-accent inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-colors {tagClass(count)}"
            onclick={() => selectTag(t)}
          >
            {t}
            <span class="text-xs opacity-60">{count}</span>
          </button>
        {/each}
      </div>
    {/if}
  {:else}
    <!-- 筛选：带指定标签的文章 -->
    <h1 class="mb-4 text-2xl font-semibold">
      标签：<Badge variant="secondary">{tag}</Badge>
    </h1>

    {#if posts.length === 0}
      <Card.Root>
        <Card.Content class="text-muted-foreground pt-6">
          {contentStore.state.loaded ? '没有带此标签的内容' : '正在加载内容...'}
        </Card.Content>
      </Card.Root>
    {:else}
      {#each posts as post (post.path)}
        <Card.Root
          class="mb-3 cursor-pointer transition-colors hover:bg-accent/40"
          role="button"
          tabindex={0}
          onclick={() => navController.navigateMain(`/article/${post.collection}/${post.id.stem}`)}
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              navController.navigateMain(`/article/${post.collection}/${post.id.stem}`)
            }
          }}
        >
          <Card.Content class="pt-5">
            <div class="text-muted-foreground mb-1 text-xs">
              {post.collection === 'articles' ? '文章' : '短评'} · {formatDate(post.metadata.date)}
            </div>
            <h2 class="font-semibold">{post.metadata.title ?? post.id.slug ?? post.id.stem}</h2>
          </Card.Content>
        </Card.Root>
      {/each}
    {/if}
  {/if}
</div>
