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
  import { gaubeeos } from '$lib/os/services'
  import { handlePublishError } from '$lib/os/services/publish-helper'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { notifySuccess, notifyWarning } from '$lib/apps/builtin/notifications/service.svelte'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import * as Card from '$lib/components/ui/card'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import GitCommitHorizontalIcon from '@lucide/svelte/icons/git-commit-horizontal'
  import Undo2Icon from '@lucide/svelte/icons/undo-2'
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw'
  import FilePlusIcon from '@lucide/svelte/icons/file-plus'
  import FileMinusIcon from '@lucide/svelte/icons/file-minus'
  import FilePenIcon from '@lucide/svelte/icons/file-pen'
  import { diffLines, type DiffLine } from '$lib/utils/diff'
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
      // 统一经 GitService 提交（带鉴权守卫 + 类型化错误）
      const git = await gaubeeos.requestAppService('git')
      const sha = await git.commit(msg)
      notifySuccess(`已提交（${sha.slice(0, 7)}）`)
      await load()
      message = ''
      // 刷新内容派生视图（commit 后 VFS 已 sync）
      contentStore.refresh()
    } catch (e) {
      // 复用发表流程的错误处理（未登录引导 /app/account，未装提示安装等）
      handlePublishError(e, navController)
    } finally {
      committing = false
    }
  }

  async function handleRevert(path: string) {
    await vfsStore.revert(path)
    await load()
    toast.success('已撤销修改')
  }

  /** 判断变更类型：新建/删除/修改。 */
  function changeKind(change: VfsNode): 'add' | 'del' | 'mod' {
    if (change.origin === 'local') return 'add'
    if (change.content === null) return 'del'
    return 'mod'
  }

  /** 生成 diff 行（基于 baseContent 与 content）。 */
  function changeDiff(change: VfsNode): DiffLine[] {
    if (changeKind(change) === 'add') return diffLines(null, change.content)
    if (changeKind(change) === 'del') return diffLines(change.baseContent, null)
    return diffLines(change.baseContent, change.content)
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
      {@const kind = changeKind(change)}
      {@const diff = changeDiff(change)}
      {@const adds = diff.filter((d) => d.type === 'add').length}
      {@const dels = diff.filter((d) => d.type === 'del').length}
      <Card.Root class="mb-3">
        <Card.Content class="pt-5">
          <div class="mb-2 flex items-center gap-2">
            {#if kind === 'add'}
              <FilePlusIcon class="size-4 text-emerald-500" />
            {:else if kind === 'del'}
              <FileMinusIcon class="size-4 text-destructive" />
            {:else}
              <FilePenIcon class="size-4 text-amber-500" />
            {/if}
            <code class="bg-muted rounded px-1.5 py-0.5 text-xs">{change.path}</code>
            <span class="text-muted-foreground text-xs">
              {kind === 'add' ? '新建' : kind === 'del' ? '删除' : '修改'}
              {#if kind === 'mod'}
                · <span class="text-emerald-500">+{adds}</span> <span class="text-destructive">-{dels}</span>
              {/if}
            </span>
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
          <!-- 行级 diff 预览 -->
          <div class="bg-muted/50 max-h-48 overflow-auto rounded border border-border text-xs">
            {#each diff.slice(0, 100) as line, i (i)}
              <div
                class="px-2 py-0.5 font-mono {line.type === 'add'
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : line.type === 'del'
                    ? 'bg-destructive/10 text-destructive'
                    : ''}"
              >
                <span class="text-muted-foreground mr-1 select-none">{line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}</span>{line.text}
              </div>
            {/each}
            {#if diff.length > 100}
              <div class="text-muted-foreground px-2 py-1">… 还有 {diff.length - 100} 行</div>
            {/if}
          </div>
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
