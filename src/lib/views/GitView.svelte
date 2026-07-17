<!--
	GitView：bottom 区的 Git 状态面板（简化版）。
	显示当前分支、VFS dirty 文件数、快速跳转变更页。
	完整 git 操作（diff、history、commit）在 ChangesView 完成。
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { vfs, vfsStore, BRANCH, OWNER, REPO } from '$lib/vfs/vfs.svelte'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { Button } from '$lib/components/ui/button'
  import GitBranchIcon from '@lucide/svelte/icons/git-branch'
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw'

  let dirtyCount = $state(0)
  let loading = $state(true)

  async function load() {
    loading = true
    const dirty = await vfs.dirtyFiles()
    dirtyCount = dirty.length
    loading = false
  }

  onMount(load)
</script>

<div class="flex h-full flex-col p-4">
  <div class="mb-4 flex items-center gap-2">
    <GitBranchIcon class="size-4" />
    <span class="font-medium text-sm">{BRANCH}</span>
    <span class="text-muted-foreground text-xs">{OWNER}/{REPO}</span>
    <Button variant="ghost" size="icon-sm" class="ml-auto" onclick={load} aria-label="刷新">
      <RefreshCwIcon />
    </Button>
  </div>

  <div class="flex-1">
    {#if loading}
      <p class="text-muted-foreground text-sm">加载中…</p>
    {:else if dirtyCount === 0}
      <p class="text-muted-foreground text-sm">工作区干净，没有未提交的修改。</p>
    {:else}
      <p class="mb-3 text-sm">
        有 <strong>{dirtyCount}</strong> 个未提交的修改。
      </p>
      <Button size="sm" onclick={() => navController.navigateMain('/changes')}>
        查看并提交
      </Button>
    {/if}
  </div>

  <div class="text-muted-foreground border-t border-border pt-2 text-xs">
    提示：编辑文章会自动暂存到 VFS。在「变更」标签页提交到 GitHub。
  </div>
</div>
