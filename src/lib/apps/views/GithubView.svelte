<!--
	GithubView：Github 多仓库管理应用（基于 isomorphic-git）。

	GitHub Desktop 风格（10% 成本 60% 功能）：
	- 已克隆仓库列表（切换/拉取/深克隆/移除）
	- 添加仓库（owner/repo/branch + 高级选项）
	- 提交历史（跟随当前仓库）
	- clone 进度条
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { gitStore, type CloneOptions } from '$lib/apps/GitStore.svelte'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import { Label } from '$lib/components/ui/label'
  import { Switch } from '$lib/components/ui/switch'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import * as Card from '$lib/components/ui/card'
  import GitHubMark from '$lib/components/icons/GitHubMark.svelte'
  import GitCommitIcon from '@lucide/svelte/icons/git-commit'
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw'
  import LogInIcon from '@lucide/svelte/icons/log-in'
  import CodeXmlIcon from '@lucide/svelte/icons/code-xml'
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down'
  import ChevronUpIcon from '@lucide/svelte/icons/chevron-up'
  import LayersIcon from '@lucide/svelte/icons/layers'
  import PlusIcon from '@lucide/svelte/icons/plus'
  import TrashIcon from '@lucide/svelte/icons/trash-2'
  import FolderIcon from '@lucide/svelte/icons/folder'

  // 添加仓库表单
  let owner = $state('gaubee')
  let repo = $state('gaubee.com')
  let branch = $state('main')
  let showAdvanced = $state(false)
  let customDir = $state('')
  let shallowClone = $state(true)

  // store 响应式派生
  const repos = $derived(gitStore.repos)
  const activeRepo = $derived(gitStore.activeRepo)
  const commits = $derived(gitStore.commits)
  const loading = $derived(gitStore.loading)
  const error = $derived(gitStore.error)
  const progress = $derived(gitStore.progress)
  const isShallow = $derived(gitStore.isShallow)

  onMount(() => {
    gitStore.init()
  })

  async function handleClone() {
    const opts: CloneOptions = {
      owner: owner.trim(),
      repo: repo.trim(),
      branch: branch.trim(),
      dir: customDir.trim() || undefined,
      shallow: shallowClone,
    }
    try {
      await gitStore.clone(opts)
      // 清空表单
      customDir = ''
    } catch {
      // 错误已在 store 中处理
    }
  }

  async function handlePull() {
    await gitStore.pull()
  }

  async function handleUnshallow() {
    try {
      await gitStore.unshallow()
    } catch {
      // 错误已在 store 中处理
    }
  }

  async function handleSwitch(id: string) {
    await gitStore.switchRepo(id)
  }

  async function handleRemove(id: string, name: string) {
    if (!confirm(`确定移除仓库 ${name}？\n文件数据将从浏览器中删除。`)) return
    await gitStore.removeRepo(id)
  }

  function formatDate(ts: number): string {
    return new Date(ts * 1000).toLocaleDateString('zh-CN')
  }

  /** 自动派生路径预览 */
  const dirPreview = $derived(
    customDir.trim() || `/repos/${owner.trim()}/${repo.trim()}`
  )
</script>

<div class="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
  <div class="flex items-center gap-2">
    <GitHubMark class="size-5" />
    <h1 class="text-2xl font-semibold">Github</h1>
  </div>

  <!-- 已克隆仓库列表 -->
  {#if repos.length > 0}
    <Card.Root>
      <Card.Header>
        <Card.Title class="flex items-center gap-2 text-base">
          <FolderIcon class="size-4" />
          已克隆仓库（{repos.length}）
        </Card.Title>
      </Card.Header>
      <Card.Content class="space-y-2">
        {#each repos as r (r.id)}
          {@const isActive = r.id === gitStore.activeRepoId}
          <div
            class="hover:bg-accent flex items-center gap-3 rounded-lg border p-2.5 transition-colors {isActive ? 'border-primary bg-accent/50' : ''}"
            role="button"
            tabindex={0}
            onclick={() => handleSwitch(r.id)}
            onkeydown={(e) => { if (e.key === 'Enter') handleSwitch(r.id) }}
          >
            <GitHubMark class="size-4 shrink-0" />
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="truncate text-sm font-medium">{r.owner}/{r.repo}</span>
                {#if r.shallow}
                  <span class="bg-muted text-muted-foreground flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px]">
                    <LayersIcon class="size-2.5" />
                    浅
                  </span>
                {/if}
              </div>
              <span class="text-muted-foreground font-mono text-[11px]">{r.dir}</span>
            </div>
            <!-- 操作按钮（仅当前激活仓库显示，移除外） -->
            {#if isActive}
              <Button variant="ghost" size="sm" onclick={(e) => { e.stopPropagation(); handleUnshallow() }} disabled={loading || !isShallow} class="h-7 gap-1 px-2 text-xs">
                <LayersIcon class="size-3" />
                深克隆
              </Button>
              <Button variant="ghost" size="sm" onclick={(e) => { e.stopPropagation(); handlePull() }} disabled={loading} class="h-7 gap-1 px-2 text-xs">
                <RefreshCwIcon class="size-3" />
                拉取
              </Button>
            {/if}
            <Button variant="ghost" size="sm" onclick={(e) => { e.stopPropagation(); handleRemove(r.id, `${r.owner}/${r.repo}`) }} disabled={loading} class="text-muted-foreground hover:text-destructive h-7 px-2" aria-label="移除">
              <TrashIcon class="size-3.5" />
            </Button>
          </div>
        {/each}
      </Card.Content>
    </Card.Root>
  {/if}

  <!-- 添加仓库 -->
  <Card.Root>
    <Card.Header>
      <Card.Title class="flex items-center gap-2 text-base">
        <PlusIcon class="size-4" />
        添加仓库
      </Card.Title>
    </Card.Header>
    <Card.Content class="flex flex-col gap-3">
      <div class="flex gap-2">
        <Input placeholder="用户名/组织" bind:value={owner} class="flex-1" />
        <span class="text-muted-foreground self-center">/</span>
        <Input placeholder="仓库名" bind:value={repo} class="flex-1" />
        <span class="text-muted-foreground self-center">@</span>
        <Input placeholder="分支" bind:value={branch} class="w-24" />
      </div>
      <div class="flex gap-2">
        <Button onclick={handleClone} disabled={loading}>
          {#if loading}
            <RefreshCwIcon class="size-4 animate-spin" />
            克隆中…
          {:else}
            <PlusIcon class="size-4" />
            克隆仓库
          {/if}
        </Button>
      </div>

      <!-- clone 进度条 -->
      {#if progress}
        <div class="space-y-1">
          <div class="text-muted-foreground flex items-center justify-between text-xs">
            <span>{progress.phase}</span>
            {#if progress.total > 0}
              <span class="font-mono">{Math.round((progress.loaded / progress.total) * 100)}%</span>
            {/if}
          </div>
          {#if progress.total > 0}
            <div class="bg-muted h-1.5 w-full overflow-hidden rounded-full">
              <div
                class="bg-primary h-full rounded-full transition-all duration-300"
                style="width: {Math.min(100, (progress.loaded / progress.total) * 100)}%"
              ></div>
            </div>
          {:else}
            <div class="bg-muted h-1.5 w-full overflow-hidden rounded-full">
              <div class="bg-primary h-full w-1/3 rounded-full git-progress-indeterminate"></div>
            </div>
          {/if}
        </div>
      {/if}

      <!-- 高级选项 -->
      <button
        class="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors"
        onclick={() => (showAdvanced = !showAdvanced)}
      >
        {#if showAdvanced}
          <ChevronUpIcon class="size-3" />
        {:else}
          <ChevronDownIcon class="size-3" />
        {/if}
        高级选项
      </button>
      {#if showAdvanced}
        <div class="space-y-3 rounded-lg border border-dashed p-3">
          <div class="space-y-1.5">
            <Label class="text-xs">目标路径</Label>
            <Input placeholder={dirPreview} bind:value={customDir} class="font-mono text-xs" />
            <p class="text-muted-foreground text-[11px]">
              默认 {dirPreview}。仓库数据保存到浏览器 IndexedDB（ZenFS），刷新后保留。
            </p>
          </div>
          <div class="flex items-center justify-between">
            <div class="space-y-0.5">
              <Label class="text-xs">浅克隆（depth=1）</Label>
              <p class="text-muted-foreground text-[11px]">仅拉取最新提交，大幅减少下载量</p>
            </div>
            <Switch bind:checked={shallowClone} />
          </div>
        </div>
      {/if}

      {#if error}
        <p class="text-destructive text-sm">{error}</p>
      {/if}
    </Card.Content>
  </Card.Root>

  <!-- 提交历史（当前仓库） -->
  {#if activeRepo}
    <Card.Root>
      <Card.Header>
        <Card.Title class="flex items-center gap-2 text-base">
          <GitCommitIcon class="size-4" />
          提交历史
          <span class="text-muted-foreground text-sm font-normal">
            {activeRepo.owner}/{activeRepo.repo}@{activeRepo.branch}
          </span>
          {#if isShallow}
            <span class="bg-muted text-muted-foreground flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px]">
              <LayersIcon class="size-3" />
              浅克隆
            </span>
            <Button variant="outline" size="sm" onclick={handleUnshallow} disabled={loading} class="ml-auto h-7 gap-1 text-xs">
              {#if loading}
                <RefreshCwIcon class="size-3 animate-spin" />
                深克隆中…
              {:else}
                <LayersIcon class="size-3" />
                深克隆
              {/if}
            </Button>
          {/if}
        </Card.Title>
      </Card.Header>
      <Card.Content>
        {#if loading && commits.length === 0}
          {#each Array(3) as _}
            <Skeleton class="mb-2 h-10 w-full" />
          {/each}
        {:else if commits.length === 0}
          <p class="text-muted-foreground text-sm">暂无提交</p>
        {:else}
          <div class="space-y-1">
            {#each commits as c (c.oid)}
              <div class="hover:bg-accent flex items-start gap-3 rounded-md p-2 transition-colors">
                <div class="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-mono">
                  {c.oid.slice(0, 7)}
                </div>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium">{c.message.split('\n')[0]}</p>
                  <p class="text-muted-foreground text-xs">
                    {c.author.name} · {formatDate(c.author.timestamp)}
                  </p>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </Card.Content>
    </Card.Root>
  {:else if repos.length === 0}
    <Card.Root>
      <Card.Content class="text-muted-foreground flex flex-col items-center gap-2 pt-8 pb-8 text-center text-sm">
        <CodeXmlIcon class="size-8 opacity-40" />
        <p>克隆一个仓库开始浏览</p>
      </Card.Content>
    </Card.Root>
  {/if}
</div>

<style>
  .git-progress-indeterminate {
    animation: git-progress-slide 1.2s ease-in-out infinite;
  }
  @keyframes git-progress-slide {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(400%);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .git-progress-indeterminate {
      animation: none;
      opacity: 0.6;
    }
  }
</style>
