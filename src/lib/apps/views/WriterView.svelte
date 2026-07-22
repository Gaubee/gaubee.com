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
  import { gaubeeos } from '$lib/os/services'
  import { ACCOUNT_UNAVAILABLE } from '$lib/apps/builtin/account/service'
  import { handlePublishError } from '$lib/os/services/publish-helper'
  import { vfsStore } from '$lib/vfs/vfs.svelte'
  import { contentStore } from '$lib/data/content.svelte'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { Button } from '$lib/components/ui/button'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import * as Card from '$lib/components/ui/card'
  import FileTextIcon from '@lucide/svelte/icons/file-text'
  import FolderIcon from '@lucide/svelte/icons/folder'
  import LogInIcon from '@lucide/svelte/icons/log-in'
  import SendIcon from '@lucide/svelte/icons/send'
  import GitCommitHorizontalIcon from '@lucide/svelte/icons/git-commit-horizontal'
  import { notifySuccess } from '$lib/apps/builtin/notifications/service.svelte'

  let files = $state<string[]>([])
  let loading = $state(true)
  let publishing = $state(false)

  // 通过账户服务获取登录态（不再直接 import authStore）
  const account = $derived(gaubeeos.getAppService('account'))
  const accountState = $derived(account?.state ?? ACCOUNT_UNAVAILABLE)
  // VFS dirty 文件数（待发表的本地变更）
  const dirtyCount = $derived(vfsStore.dirtyCount)

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
      navController.navigateMain(`/app/editor/${collection}/${stem}`)
    }
  }

  /**
   * 批量发表：把所有 VFS dirty 文件经 GitService 提交到 GitHub。
   * 错误处理与 EditorView.handlePublish 一致。
   */
  async function handlePublishAll() {
    publishing = true
    try {
      const git = await gaubeeos.requestAppService('git')
      const sha = await git.commit(`发表 ${dirtyCount} 个变更`)
      notifySuccess(`已发表 ${dirtyCount} 个变更（${sha.slice(0, 7)}）`, undefined, {
        label: '查看变更',
        href: '/app/changes',
      })
      await contentStore.refresh()
    } catch (e) {
      handlePublishError(e, navController)
    } finally {
      publishing = false
    }
  }
</script>

<div class="mx-auto max-w-3xl p-4 sm:p-6">
  <div class="mb-4 flex items-center justify-between">
    <h1 class="text-2xl font-semibold">写作</h1>
    <div class="flex gap-2">
      <Button size="sm" variant="outline" onclick={() => navController.navigateMain('/app/files')}>
        <FolderIcon data-icon="inline-start" />
        文件
      </Button>
      {#if accountState.authenticated}
        <Button size="sm" variant="outline" onclick={() => contentStore.refresh()}>
          刷新
        </Button>
      {/if}
    </div>
  </div>

  {#if !accountState.authenticated}
    <Card.Root class="mb-4">
      <Card.Content class="flex flex-col items-center gap-3 pt-8 pb-8 text-center">
        <p class="text-muted-foreground">登录后可以编辑文章并提交到 GitHub</p>
        <Button onclick={() => account?.login()}>
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

    <!-- 待发表变更（VFS dirty 文件）批量提交入口 -->
    {#if dirtyCount > 0}
      <Card.Root class="mt-4">
        <Card.Content class="flex items-center gap-3 pt-5">
          <GitCommitHorizontalIcon class="text-muted-foreground size-5" />
          <div class="flex-1">
            <div class="text-sm font-medium">{dirtyCount} 个待发表变更</div>
            <div class="text-muted-foreground text-xs">编辑后自动暂存的本地修改，可一并提交到 GitHub。</div>
          </div>
          <Button size="sm" onclick={handlePublishAll} disabled={publishing}>
            <SendIcon data-icon="inline-start" />
            {publishing ? '发表中…' : '批量发表'}
          </Button>
        </Card.Content>
      </Card.Root>
    {/if}
  {/if}
</div>
