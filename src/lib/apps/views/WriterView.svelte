<!--
	WriterView：写作应用（从可写 VFS 读取/写入）。
	
	这是一个可选安装的应用。安装后，从可写 VFS 读取文章/说说数据：
	- 如果 VFS 中没有数据（从未编辑过），自动从只读层复制一份
	- 编辑后保存到可写层（IndexedDB）
	- 支持提交到 GitHub
	
	注意：首次安装时，如果用户未登录，只读显示，编辑/提交需要登录。
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { authStore } from '$lib/auth/session.svelte'
  import { vfsStore } from '$lib/vfs/vfs.svelte'
  import { contentStore } from '$lib/data/content.svelte'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { Button } from '$lib/components/ui/button'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import * as Card from '$lib/components/ui/card'
  import FileTextIcon from '@lucide/svelte/icons/file-text'
  import LogInIcon from '@lucide/svelte/icons/log-in'

  let files = $state<string[]>([])
  let loading = $state(true)

  const authState = $derived(authStore.state)

  onMount(async () => {
    // 从 VFS 获取文件列表（包含只读层 + 可写层）
    await contentStore.refresh()
    const articles = contentStore.articles.map(p => p.path)
    const events = contentStore.events.map(p => p.path)
    files = [...articles, ...events].sort()
    loading = false
  })

  function navigateToEditor(path: string) {
    // 从路径推断 collection 和 stem
    const match = path.match(/^src\/(content)\/(articles|events)\/(.+)\.md$/)
    if (match) {
      const collection = match[2]
      const stem = match[3]
      navController.navigateMain(`/editor/${collection}/${stem}`)
    }
  }
</script>

<div class="mx-auto max-w-3xl p-4 sm:p-6">
  <div class="mb-4 flex items-center justify-between">
    <h1 class="text-2xl font-semibold">写作</h1>
    {#if authState.authenticated}
      <Button size="sm" variant="outline" onclick={() => contentStore.refresh()}>
        刷新
      </Button>
    {/if}
  </div>

  {#if !authState.authenticated}
    <Card.Root class="mb-4">
      <Card.Content class="flex flex-col items-center gap-3 pt-8 pb-8 text-center">
        <p class="text-muted-foreground">登录后可以编辑文章并提交到 GitHub</p>
        <Button onclick={() => authStore.login()}>
          <LogInIcon data-icon="inline-start" />
          用 GitHub 登录
        </Button>
      </Card.Content>
    </Card.Root>
  {/if}

  {#if loading}
    {#each Array(3) as _}
      <Card.Root class="mb-2">
        <Card.Content class="py-3">
          <Skeleton class="h-4 w-3/4" />
        </Card.Content>
      </Card.Root>
    {/each}
  {:else if files.length === 0}
    <Card.Root>
      <Card.Content class="flex flex-col items-center gap-3 pt-12 pb-12 text-center">
        <p class="text-muted-foreground">还没有内容</p>
      </Card.Content>
    </Card.Root>
  {:else}
    <div class="flex flex-col gap-2">
      {#each files as path (path)}
        {@const isArticle = path.includes('/articles/')}
        <button
          class="hover:bg-accent flex items-center gap-2 rounded-md border p-3 text-left transition-colors"
          onclick={() => navigateToEditor(path)}
        >
          <FileTextIcon class="text-muted-foreground size-4" />
          <div class="flex-1 min-w-0">
            <span class="text-sm">{path.split('/').pop()}</span>
            <span class="text-muted-foreground text-xs ml-2">{isArticle ? '文章' : '说说'}</span>
          </div>
        </button>
      {/each}
    </div>
  {/if}
</div>
