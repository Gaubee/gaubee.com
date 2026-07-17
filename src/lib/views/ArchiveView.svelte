<!--
	ArchiveView：归档页，按年月分组显示所有内容。
	左侧可按标签快速筛选，右侧按月份列出。
-->
<script lang="ts">
  import { contentStore } from '$lib/data/content.svelte'
  import { navController } from '$lib/nav/nav-controller-instance'
  import * as Card from '$lib/components/ui/card'
  import { Badge } from '$lib/components/ui/badge'

  const contentState = $derived(contentStore.state)
  const byMonth = $derived(contentStore.postsByMonth)
  const tags = $derived(contentStore.allTags)

  let selectedTag = $state<string | null>(null)

  const filteredPosts = $derived(
    selectedTag ? contentState.posts.filter((p) => p.metadata.tags.includes(selectedTag!)) : contentState.posts
  )

  function groupByMonth(posts: typeof contentState.posts): Map<string, typeof contentState.posts> {
    const map = new Map<string, typeof contentState.posts>()
    for (const post of [...posts].sort((a, b) => b.metadata.date.getTime() - a.metadata.date.getTime())) {
      const d = post.metadata.date
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(post)
    }
    return map
  }

  const grouped = $derived(groupByMonth(filteredPosts))

  function formatMonth(key: string): string {
    const [y, m] = key.split('-')
    return `${y} 年 ${Number(m)} 月`
  }
</script>

<div class="mx-auto flex max-w-4xl gap-6 p-4 sm:p-6">
  <!-- 标签侧栏 -->
  <aside class="hidden w-48 shrink-0 sm:block">
    <div class="text-muted-foreground mb-2 text-xs font-medium uppercase tracking-wider">标签</div>
    <button
      class="hover:bg-accent mb-1 block w-full rounded-md px-2 py-1 text-left text-sm {!selectedTag ? 'bg-accent font-medium' : ''}"
      onclick={() => (selectedTag = null)}
    >
      全部（{contentState.posts.length}）
    </button>
    {#each [...tags.entries()] as [tag, count]}
      <button
        class="hover:bg-accent mb-1 flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-sm {selectedTag === tag ? 'bg-accent font-medium' : ''}"
        onclick={() => (selectedTag = selectedTag === tag ? null : tag)}
      >
        <span class="truncate">{tag}</span>
        <span class="text-muted-foreground text-xs">{count}</span>
      </button>
    {/each}
  </aside>

  <!-- 归档主区 -->
  <div class="min-w-0 flex-1">
    <h1 class="mb-4 text-2xl font-semibold">
      归档
      {#if selectedTag}
        <Badge variant="secondary" class="ml-2">{selectedTag}</Badge>
      {/if}
    </h1>

    {#if !contentState.loaded}
      <p class="text-muted-foreground text-sm">加载中…</p>
    {:else if grouped.size === 0}
      <Card.Root>
        <Card.Content class="text-muted-foreground pt-6">暂无内容</Card.Content>
      </Card.Root>
    {:else}
      {#each [...grouped.entries()] as [month, posts] (month)}
        <div class="mb-6">
          <h2 class="text-muted-foreground mb-2 text-sm font-semibold">{formatMonth(month)}</h2>
          <div class="space-y-0.5">
            {#each posts as post (post.path)}
              <button
                class="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors"
                onclick={() => navController.navigateMain(`/article/${post.collection}/${post.id.stem}`)}
              >
                <span class="text-muted-foreground w-6 shrink-0 text-xs">
                  {post.metadata.date.getDate()}
                </span>
                <span class="truncate">{post.metadata.title ?? post.id.slug ?? post.id.stem}</span>
                <span class="text-muted-foreground ml-auto text-xs">
                  {post.collection === 'articles' ? '文章' : '短评'}
                </span>
              </button>
            {/each}
          </div>
        </div>
      {/each}
    {/if}
  </div>
</div>
