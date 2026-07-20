<!--
	ArticlesView：文章应用（纯只读）。
	
	从 ReadonlyVFS（构建时静态数据）读取，无需登录即可阅读。
	数据在构建时预解析，运行时零延迟。
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { readonlyVfs } from '$lib/vfs/readonly'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { Button } from '$lib/components/ui/button'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import * as Card from '$lib/components/ui/card'
  import { Badge } from '$lib/components/ui/badge'
  import FileTextIcon from '@lucide/svelte/icons/file-text'
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw'
  import type { ReadonlyPost } from '$lib/vfs/readonly'

  let posts = $state<ReadonlyPost[]>([])
  let loading = $state(true)

  onMount(() => {
    // 从只读 VFS 获取文章（无需登录，零延迟）
    const articles = readonlyVfs.getPostsByCollection('articles')
    // 按日期降序排序
    posts = articles.sort((a, b) => b.metadata.date.getTime() - a.metadata.date.getTime())
    loading = false
  })

  function formatDate(d: Date): string {
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
  }
</script>

<div class="mx-auto max-w-3xl p-4 sm:p-6">
  <div class="mb-4 flex items-center justify-between">
    <h1 class="text-2xl font-semibold">文章</h1>
  </div>

  {#if loading}
    {#each Array(3) as _}
      <Card.Root class="mb-3">
        <Card.Content class="pt-6">
          <Skeleton class="mb-2 h-5 w-3/4" />
          <Skeleton class="mb-3 h-3 w-1/4" />
          <Skeleton class="h-4 w-full" />
          <Skeleton class="mt-1 h-4 w-5/6" />
        </Card.Content>
      </Card.Root>
    {/each}
  {:else if posts.length === 0}
    <Card.Root>
      <Card.Content class="flex flex-col items-center gap-3 pt-12 pb-12 text-center">
        <p class="text-muted-foreground">还没有文章</p>
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
          <div class="text-muted-foreground mb-2 flex items-center gap-2 text-xs">
            <FileTextIcon class="size-3.5" />
            <span>文章</span>
            <span>·</span>
            <time>{formatDate(post.metadata.date)}</time>
          </div>
          <h2 class="mb-2 text-lg font-semibold">
            {post.metadata.title ?? post.id.slug ?? post.id.stem}
          </h2>
          {#if post.body.trim()}
            <div class="text-muted-foreground text-sm line-clamp-3">
              {post.body.slice(0, 200)}
            </div>
          {/if}
          {#if post.metadata.tags.length > 0}
            <div class="flex flex-wrap gap-1">
              {#each post.metadata.tags.slice(0, 5) as tag}
                <Badge variant="secondary" class="text-xs">{tag}</Badge>
              {/each}
            </div>
          {/if}
        </Card.Content>
      </Card.Root>
    {/each}
  {/if}
</div>
