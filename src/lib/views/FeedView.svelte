<!--
	FeedView：阅读模式时间线（articles + events 合并卡片流）。
	阶段 4：从 contentStore 拉取数据，展示卡片列表。卡片完整渲染在阶段 6/7。
	未登录时提示去设置登录（GitHub API 需要认证）。
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { contentStore } from '$lib/data/content.svelte'
  import { authStore } from '$lib/auth/session.svelte'
  import { navController } from '$lib/nav/nav-controller-instance'
  import MarkdownViewer from '$lib/markdown/MarkdownViewer.svelte'
  import { Button } from '$lib/components/ui/button'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import * as Card from '$lib/components/ui/card'
  import { Badge } from '$lib/components/ui/badge'
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw'
  import LogInIcon from '@lucide/svelte/icons/log-in'
  import FileTextIcon from '@lucide/svelte/icons/file-text'
  import MessageSquareIcon from '@lucide/svelte/icons/message-square'

  const state = $derived(contentStore.state)
  const posts = $derived(contentStore.allPosts)
  const authState = $derived(authStore.state)

  // 首次进入且未加载时拉取
  onMount(() => {
    if (!state.loaded && !state.loading) {
      contentStore.refresh()
    }
  })

  function formatDate(d: Date): string {
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
  }
</script>

<div class="mx-auto max-w-3xl p-4 sm:p-6">
  <div class="mb-4 flex items-center justify-between">
    <h1 class="text-2xl font-semibold">阅读</h1>
    <Button
      variant="outline"
      size="sm"
      onclick={() => contentStore.refresh()}
      disabled={state.loading}
    >
      <RefreshCwIcon data-icon="inline-start" />
      {state.loading ? '加载中' : '刷新'}
    </Button>
  </div>

  {#if state.loading && posts.length === 0}
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
  {:else if state.error}
    <Card.Root>
      <Card.Content class="pt-6">
        <p class="text-destructive mb-2 font-medium">加载失败</p>
        <p class="text-muted-foreground text-sm">{state.error}</p>
        {#if !authState.authenticated}
          <p class="text-muted-foreground mt-3 text-sm">
            GitHub API 需要认证。请先
            <button
              class="text-primary underline"
              onclick={() => navController.navigateMain('/settings')}
            >
              登录
            </button>
            。
          </p>
        {/if}
      </Card.Content>
    </Card.Root>
  {:else if posts.length === 0}
    <Card.Root>
      <Card.Content class="flex flex-col items-center gap-3 pt-12 pb-12 text-center">
        <p class="text-muted-foreground">还没有内容</p>
        {#if !authState.authenticated}
          <Button size="sm" onclick={() => navController.navigateMain('/settings')}>
            <LogInIcon data-icon="inline-start" />
            登录以加载内容
          </Button>
        {:else}
          <Button size="sm" onclick={() => contentStore.refresh()}>
            <RefreshCwIcon data-icon="inline-start" />
            重新加载
          </Button>
        {/if}
      </Card.Content>
    </Card.Root>
  {:else}
    {#each posts as post (post.path)}
      <Card.Root
        class="mb-3 cursor-pointer transition-colors hover:bg-accent/40"
        onclick={() => navController.navigateMain(`/article/${post.collection}/${post.id.stem}`)}
      >
        <Card.Content class="pt-5">
          <div class="text-muted-foreground mb-2 flex items-center gap-2 text-xs">
            {#if post.collection === 'articles'}
              <FileTextIcon class="size-3.5" />
              <span>文章</span>
            {:else}
              <MessageSquareIcon class="size-3.5" />
              <span>短评</span>
            {/if}
            <span>·</span>
            <time>{formatDate(post.metadata.date)}</time>
          </div>
          <h2 class="mb-2 text-lg font-semibold">
            {post.metadata.title ?? post.id.slug ?? post.id.stem}
          </h2>
          {#if post.body.trim()}
            <div class="text-muted-foreground text-sm">
              <MarkdownViewer markdown={post.body} maxLines={6} inline />
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
