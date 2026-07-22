<!--
	FilesView：虚拟文件系统浏览。
	- 列出 VFS 里 src/content/articles 与 events 下的文件
	- 点击 .md 文件 → 在编辑器打开
	- 新建文章/短评：生成下一个序号的空文件，写入 VFS，打开编辑器
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { vfsStore } from '$lib/vfs/vfs.svelte'
  import { contentStore } from '$lib/data/content.svelte'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { Button } from '$lib/components/ui/button'
  import * as Card from '$lib/components/ui/card'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import { gaubeeos } from '$lib/os/services'
  import { ACCOUNT_UNAVAILABLE } from '$lib/apps/builtin/account/service'
  import { notifySuccess } from '$lib/apps/builtin/notifications/service.svelte'
  import { serializeMarkdown } from '$lib/data/frontmatter'
  import FileTextIcon from '@lucide/svelte/icons/file-text'
  import FolderIcon from '@lucide/svelte/icons/folder'
  import PlusIcon from '@lucide/svelte/icons/plus'
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw'

  // 通过账户服务获取登录态（不再直接 import authStore）
  const account = $derived(gaubeeos.getAppService('account'))
  const accountState = $derived(account?.state ?? ACCOUNT_UNAVAILABLE)
  const articles = $derived(vfsStore.filesInCollection('articles'))
  const events = $derived(vfsStore.filesInCollection('events'))

  onMount(() => {
    // 确保 VFS 已同步（contentStore.refresh 会触发）
    if (!vfsStore.loaded) contentStore.refresh()
  })

  function basename(path: string): string {
    return path.split('/').pop() ?? path
  }

  function stemOf(path: string): string {
    return basename(path).replace(/\.md$/, '')
  }

  function openFile(path: string) {
    const match = path.match(/^src\/content\/(articles|events)\/(.+)\.md$/)
    if (match) {
      navController.navigateMain(`/app/editor/${match[1]}/${match[2]}`)
    }
  }

  /**
   * 新建文章/短评：扫描已有文件取最大序号 +1，生成空 markdown 写入 VFS，打开编辑器。
   * articles 用 4 位序号，events 用 5 位。
   */
  async function createNew(collection: 'articles' | 'events') {
    const existing = collection === 'articles' ? articles : events
    const digits = collection === 'articles' ? 4 : 5
    let maxSeq = 0
    for (const f of existing) {
      const m = basename(f.path).match(/^(\d+)/)
      if (m) maxSeq = Math.max(maxSeq, Number(m[1]))
    }
    const seq = String(maxSeq + 1).padStart(digits, '0')
    const stem = seq
    const path = `src/content/${collection}/${stem}.md`
    const content = serializeMarkdown(
      { date: new Date(), tags: [] },
      '',
    )
    await vfsStore.write(path, content)
    notifySuccess(`已新建 ${collection === 'articles' ? '文章' : '短评'} ${stem}`)
    navController.navigateMain(`/app/editor/${collection}/${stem}`)
  }
</script>

<div class="mx-auto max-w-3xl p-4 sm:p-6">
  <div class="mb-4 flex items-center justify-between">
    <h1 class="text-2xl font-semibold">文件</h1>
    <div class="flex gap-2">
      <Button variant="outline" size="sm" onclick={() => createNew('articles')}>
        <PlusIcon data-icon="inline-start" />
        新建文章
      </Button>
      <Button variant="outline" size="sm" onclick={() => createNew('events')}>
        <PlusIcon data-icon="inline-start" />
        新建短评
      </Button>
    </div>
  </div>

  {#if !accountState.authenticated}
    <Card.Root class="mb-4">
      <Card.Content class="text-muted-foreground pt-5 text-sm">
        GitHub API 需要认证才能浏览与编辑文件。请先
        <button
          class="text-primary underline"
          onclick={() => navController.navigateMain('/app/account')}
        >
          登录
        </button>
        。
      </Card.Content>
    </Card.Root>
  {/if}

  {#if vfsStore.loading && articles.length === 0 && events.length === 0}
    {#each Array(4) as _, i (i)}
      <Skeleton class="mb-2 h-8" />
    {/each}
  {:else if vfsStore.error}
    <Card.Root>
      <Card.Content class="text-destructive pt-5">{vfsStore.error}</Card.Content>
    </Card.Root>
  {:else}
    <!-- articles -->
    <div class="mb-6">
      <div class="text-muted-foreground mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider">
        <FolderIcon class="size-3.5" />
        文章（{articles.length}）
      </div>
      <div class="flex flex-col gap-0.5">
        {#each articles as entry (entry.path)}
          <button
            class="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors"
            onclick={() => openFile(entry.path)}
          >
            <FileTextIcon class="text-muted-foreground size-4 shrink-0" />
            <span class="truncate">{basename(entry.path)}</span>
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
      <div class="flex flex-col gap-0.5">
        {#each events as entry (entry.path)}
          <button
            class="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors"
            onclick={() => openFile(entry.path)}
          >
            <FileTextIcon class="text-muted-foreground size-4 shrink-0" />
            <span class="truncate">{basename(entry.path)}</span>
          </button>
        {/each}
      </div>
    </div>
  {/if}
</div>
