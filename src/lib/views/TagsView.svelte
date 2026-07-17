<!--
	TagsView：标签筛选页（深链接 /tags/{tag}）。
	显示带指定标签的所有文章。
-->
<script lang="ts">
  import { contentStore } from '$lib/data/content.svelte'
  import { navStore } from '$lib/nav/nav.svelte'
  import { navController } from '$lib/nav/nav-controller-instance'
  import * as Card from '$lib/components/ui/card'
  import { Badge } from '$lib/components/ui/badge'

  const navState = $derived(navStore.current)
  const tag = $derived.by(() => {
    const match = navState.mainLocation.pathname.match(/^\/tags\/(.+)$/)
    return match ? decodeURIComponent(match[1]) : ''
  })

  const posts = $derived(
    tag ? contentStore.allPosts.filter((p) => p.metadata.tags.includes(tag)) : []
  )

  function formatDate(d: Date): string {
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
  }
</script>

<div class="mx-auto max-w-3xl p-4 sm:p-6">
  <h1 class="mb-4 text-2xl font-semibold">
    标签：<Badge variant="secondary">{tag || '全部'}</Badge>
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
        onclick={() => navController.navigateMain(`/article/${post.collection}/${post.id.stem}`)}
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
</div>
