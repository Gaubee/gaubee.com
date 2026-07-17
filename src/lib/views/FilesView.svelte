<!--
	FilesView：GitHub 文件树浏览。
	- 列出 src/content/articles 与 events 下的文件
	- 点击 .md 文件 → 在编辑器打开
	- 快捷操作：新建文章/短评（阶段 7 简化：跳转到编辑器新文档）
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { listCollectionFiles, type GhContentEntry } from '$lib/github/client'
  import { contentStore } from '$lib/data/content.svelte'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { Button } from '$lib/components/ui/button'
  import * as Card from '$lib/components/ui/card'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import { authStore } from '$lib/auth/session.svelte'
  import FileTextIcon from '@lucide/svelte/icons/file-text'
  import FolderIcon from '@lucide/svelte/icons/folder'
  import PlusIcon from '@lucide/svelte/icons/plus'
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw'
  import { toast } from 'svelte-sonner'

  let articles = $state<GhContentEntry[]>([])
  let events = $state<GhContentEntry[]>([])
  let loading = $state(true)
  let error = $state<string | null>(null)
  const authState = $derived(authStore.state)

  async function load() {
    loading = true
    error = null
    try {
      // 从 contentStore 复用（已缓存），否则直接 list
      if (contentStore.state.loaded) {
        articles = contentStore.articles.map((p) => ({
          type: 'file' as const,
          size: 0,
          name: p.filename,
          path: p.path,
          sha: p.sha,
        }))
        events = contentStore.events.map((p) => ({
          type: 'file' as const,
          size: 0,
          name: p.filename,
          path: p.path,
          sha: p.sha,
        }))
      } else {
        ;[articles, events] = await Promise.all([
          listCollectionFiles('articles'),
          listCollectionFiles('events'),
        ])
      }
    } catch (e) {
      error = e instanceof Error ? e.message : '加载失败'
    } finally {
      loading = false
    }
  }

  onMount(() => {
    if (!contentStore.state.loaded) contentStore.refresh()
    load()
  })

  function openFile(entry: GhContentEntry) {
    // articles/0057.tc39-signals.md → /editor/articles/0057.tc39-signals
    const match = entry.path.match(/^src\/content\/(articles|events)\/(.+)\.md$/)
    if (match) {
      navController.navigateMain(`/editor/${match[1]}/${match[2]}`)
    } else {
      toast.info('仅支持编辑 markdown 文件')
    }
  }
</script>

<div class="mx-auto max-w-3xl p-4 sm:p-6">
  <div class="mb-4 flex items-center justify-between">
    <h1 class="text-2xl font-semibold">文件</h1>
    <Button variant="outline" size="sm" onclick={load} disabled={loading}>
      <RefreshCwIcon data-icon="inline-start" />
      刷新
    </Button>
  </div>

  {#if !authState.authenticated}
    <Card.Root class="mb-4">
      <Card.Content class="text-muted-foreground pt-5 text-sm">
        GitHub API 需要认证才能浏览文件。请先
        <button
          class="text-primary underline"
          onclick={() => navController.navigateMain('/settings')}
        >
          登录
        </button>
        。
      </Card.Content>
    </Card.Root>
  {/if}

  {#if loading}
    {#each Array(4) as _}
      <Skeleton class="mb-2 h-8" />
    {/each}
  {:else if error}
    <Card.Root>
      <Card.Content class="text-destructive pt-5">{error}</Card.Content>
    </Card.Root>
  {:else}
    <!-- articles -->
    <div class="mb-6">
      <div class="text-muted-foreground mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider">
        <FolderIcon class="size-3.5" />
        文章（{articles.length}）
      </div>
      <div class="space-y-0.5">
        {#each articles as entry (entry.path)}
          <button
            class="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors"
            onclick={() => openFile(entry)}
          >
            <FileTextIcon class="text-muted-foreground size-4 shrink-0" />
            <span class="truncate">{entry.name}</span>
          </button>
        {/each}
      </div>
    </div>

    <!-- events -->
    <div>
      <div class="text-muted-foreground mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider">
        <FolderIcon class="size-3.5" />
        短评（{events.length}）
      </div>
      <div class="space-y-0.5">
        {#each events as entry (entry.path)}
          <button
            class="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors"
            onclick={() => openFile(entry)}
          >
            <FileTextIcon class="text-muted-foreground size-4 shrink-0" />
            <span class="truncate">{entry.name}</span>
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>
