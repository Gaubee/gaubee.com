<!--
	ChangesView：暂存变更 + commit 到 GitHub。
	- 列出 VFS 里所有 dirty 文件（vfsStore.dirtyFiles）
	- 每条可预览内容片段，可撤销（vfs.revert）
	- commit 按钮：输入 message，调 vfsStore.commit（Git Data API）
	- commit 成功后 dirty 清除
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { vfs, vfsStore, type VfsNode } from '$lib/vfs/vfs.svelte'
  import { contentStore } from '$lib/data/content.svelte'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import * as Card from '$lib/components/ui/card'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import GitCommitHorizontalIcon from '@lucide/svelte/icons/git-commit-horizontal'
  import Undo2Icon from '@lucide/svelte/icons/undo-2'
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw'
  import { notifySuccess, notifyError, notifyWarning } from '$lib/apps/builtin/notifications/service.svelte'
  import { toast } from 'svelte-sonner'

  let changes = $state<VfsNode[]>([])
  let loading = $state(true)
  let committing = $state(false)
  let message = $state('')

  async function load() {
    loading = true
    changes = await vfs.dirtyFiles()
    loading = false
  }

  onMount(load)

  async function handleCommit() {
    if (changes.length === 0) {
      notifyWarning('没有待提交的变更')
      return
    }
    const msg = message.trim() || `更新 ${changes.length} 个文件`
    committing = true
    try {
      const sha = await vfsStore.commit(msg)
      notifySuccess(`已提交（${sha.slice(0, 7)}）`)
      await load()
      message = ''
      // 刷新内容派生视图（commit 后 VFS 已 sync）
      contentStore.refresh()
    } catch (e) {
      notifyError('提交失败', e instanceof Error ? e.message : String(e))
    } finally {
      committing = false
    }
  }

  async function handleRevert(path: string) {
    await vfsStore.revert(path)
    await load()
    toast.success('已撤销修改')
  }
</script>

<div class="mx-auto max-w-3xl p-4 sm:p-6">
  <div class="mb-4 flex items-center justify-between">
    <h1 class="text-2xl font-semibold">变更</h1>
    <Button variant="outline" size="sm" onclick={load} disabled={loading}>
      <RefreshCwIcon data-icon="inline-start" />
      刷新
    </Button>
  </div>

  {#if loading}
    {#each Array(2) as _}
      <Skeleton class="mb-3 h-20" />
    {/each}
  {:else if changes.length === 0}
    <Card.Root>
      <Card.Content class="text-muted-foreground pt-6 pb-6 text-center">
        没有待提交的变更。编辑文章后会自动暂存到这里。
      </Card.Content>
    </Card.Root>
  {:else}
    <!-- 变更列表 -->
    {#each changes as change (change.path)}
      <Card.Root class="mb-3">
        <Card.Content class="pt-5">
          <div class="mb-2 flex items-center gap-2">
            <code class="bg-muted rounded px-1.5 py-0.5 text-xs">{change.path}</code>
            <span class="text-muted-foreground text-xs">
              {new Date(change.mtime).toLocaleString('zh-CN')}
            </span>
            <Button
              size="icon-sm"
              variant="ghost"
              class="ml-auto"
              onclick={() => handleRevert(change.path)}
              aria-label="撤销修改"
            >
              <Undo2Icon />
            </Button>
          </div>
          {#if change.content !== null}
            <pre class="bg-muted max-h-24 overflow-auto rounded p-2 text-xs">{change.content.slice(0, 300)}{change.content.length > 300 ? '…' : ''}</pre>
          {:else}
            <span class="text-destructive text-sm">（删除）</span>
          {/if}
        </Card.Content>
      </Card.Root>
    {/each}

    <!-- commit 区 -->
    <Card.Root class="mt-4">
      <Card.Content class="pt-5">
        <label for="commit-msg" class="mb-1.5 block text-sm font-medium">提交信息</label>
        <Input
          id="commit-msg"
          type="text"
          value={message}
          oninput={(e) => (message = e.currentTarget.value)}
          placeholder="描述本次变更（可选）"
          class="mb-3"
        />
        <Button onclick={handleCommit} disabled={committing}>
          <GitCommitHorizontalIcon data-icon="inline-start" />
          {committing ? '提交中…' : `提交 ${changes.length} 个变更到 GitHub`}
        </Button>
      </Card.Content>
    </Card.Root>
  {/if}
</div>
