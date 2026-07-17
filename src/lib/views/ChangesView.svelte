<!--
	ChangesView：暂存变更 + commit 到 GitHub。
	- 列出 IndexedDB 里的 stagedChanges
	- 每条可预览 diff（简化：显示路径 + 内容片段）
	- commit 按钮：输入 message，调 commitChanges（Git Data API）
	- commit 成功后清空 stagedChanges
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import {
    getAllStagedChanges,
    unstageChange,
    clearStagedChanges,
    type StagedChangeShape,
  } from '$lib/db'
  import { commitChanges } from '$lib/github/client'
  import { contentStore } from '$lib/data/content.svelte'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import * as Card from '$lib/components/ui/card'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import GitCommitHorizontalIcon from '@lucide/svelte/icons/git-commit-horizontal'
  import Trash2Icon from '@lucide/svelte/icons/trash-2'
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw'
  import { toast } from 'svelte-sonner'

  let changes = $state<StagedChangeShape[]>([])
  let loading = $state(true)
  let committing = $state(false)
  let message = $state('')

  async function load() {
    loading = true
    changes = await getAllStagedChanges()
    loading = false
  }

  onMount(load)

  async function handleCommit() {
    if (changes.length === 0) {
      toast.warning('没有待提交的变更')
      return
    }
    const msg = message.trim() || `更新 ${changes.length} 个文件`
    committing = true
    try {
      const sha = await commitChanges(
        msg,
        changes.map((c) => ({ path: c.path, content: c.content }))
      )
      toast.success(`已提交（${sha.slice(0, 7)}）`)
      await clearStagedChanges()
      await load()
      message = ''
      // 刷新内容缓存（拉取新版本）
      contentStore.refresh()
    } catch (e) {
      toast.error('提交失败', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      committing = false
    }
  }

  async function handleRemove(path: string) {
    await unstageChange(path)
    await load()
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
              {new Date(change.updatedAt).toLocaleString('zh-CN')}
            </span>
            <Button
              size="icon-sm"
              variant="ghost"
              class="ml-auto"
              onclick={() => handleRemove(change.path)}
              aria-label="移除变更"
            >
              <Trash2Icon />
            </Button>
          </div>
          {#if change.content}
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
