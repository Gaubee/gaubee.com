<!--
	GithubView：GitHub REST API 控制台（推倒重设计）。

	不再依赖 isomorphic-git clone（已降级为 CLI 的 `git clone`）。
	新形态：
	- 仓库选择器：默认 gaubee/gaubee.com（主仓库，可写）；
	  支持输入任意 owner/repo 做只读多仓库浏览（历史 / 文件树）。
	- 历史 Tab：listCommits() REST API
	- 文件 Tab：listContents() + getFileText() REST API（懒加载文件树）
	- 变更 Tab：vfsStore dirty 列表 + gitService.commit()（仅主仓库 gaubee/gaubee.com）
	- 日志 Tab：activityLog.activities（各 App 的 git 操作记录）
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { gaubeeos } from '$lib/os/services'
  import { handlePublishError } from '$lib/os/services/publish-helper'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { notifySuccess, notifyWarning } from '$lib/apps/builtin/notifications/service.svelte'
  import {
    listCommits,
    listContents,
    getFileText,
    OWNER,
    REPO,
    type CommitInfo,
    type GhContentEntry,
  } from '$lib/github/client'
  import { vfs, vfsStore, type VfsNode } from '$lib/vfs/vfs.svelte'
  import { activityLog, type GitActivity } from '$lib/apps/installable/github/activity-log.svelte'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import { Badge } from '$lib/components/ui/badge'
  import * as Card from '$lib/components/ui/card'
  import * as Tabs from '$lib/components/ui/tabs'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import GitHubMark from '$lib/components/icons/GitHubMark.svelte'
  import GitCommitHorizontalIcon from '@lucide/svelte/icons/git-commit-horizontal'
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw'
  import HistoryIcon from '@lucide/svelte/icons/history'
  import FolderIcon from '@lucide/svelte/icons/folder'
  import FileTextIcon from '@lucide/svelte/icons/file-text'
  import FilePlusIcon from '@lucide/svelte/icons/file-plus'
  import FileMinusIcon from '@lucide/svelte/icons/file-minus'
  import FilePenIcon from '@lucide/svelte/icons/file-pen'
  import ScrollTextIcon from '@lucide/svelte/icons/scroll-text'
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right'
  import Undo2Icon from '@lucide/svelte/icons/undo-2'

  // ---- 仓库选择 ----
  let ownerInput = $state(OWNER)
  let repoInput = $state(REPO)
  /** 当前正在浏览的仓库。默认主仓库 gaubee/gaubee.com。 */
  let owner = $state(OWNER)
  let repo = $state(REPO)
  const isMainRepo = $derived(owner === OWNER && repo === REPO)

  // ---- 历史 Tab ----
  let commits = $state<CommitInfo[]>([])
  let commitsLoading = $state(false)
  let commitsError = $state<string | null>(null)

  // ---- 文件 Tab ----
  /** 文件树：按目录组织。key=目录路径（'' 表示根），value=该目录直系条目。 */
  type TreeNode = { dirs: GhContentEntry[]; files: GhContentEntry[] }
  let tree = $state<Map<string, TreeNode>>(new Map())
  /** 已展开的目录路径集合。 */
  let expanded = $state<Set<string>>(new Set(['']))
  /** 当前选中的文件 path 与内容。 */
  let selectedFile = $state<string | null>(null)
  let fileContent = $state<string>('')
  let fileLoading = $state(false)
  let filesError = $state<string | null>(null)

  // ---- 变更 Tab（仅主仓库）----
  let changes = $state<VfsNode[]>([])
  let changesLoading = $state(false)
  let message = $state('')
  let committing = $state(false)

  // ---- 日志 Tab ----
  const activities = $derived(activityLog.activities)

  onMount(() => {
    void activityLog.init()
    void loadCommits()
    void loadDir('')
    void loadChanges()
  })

  // ---- 仓库切换 ----
  function applyRepo() {
    const o = ownerInput.trim() || OWNER
    const r = repoInput.trim() || REPO
    if (o === owner && r === repo) return
    owner = o
    repo = r
    // 重置所有数据
    commits = []
    tree = new Map()
    expanded = new Set([''])
    selectedFile = null
    fileContent = ''
    filesError = null
    commitsError = null
    void loadCommits()
    void loadDir('')
  }

  // ---- 历史 ----
  async function loadCommits() {
    commitsLoading = true
    commitsError = null
    try {
      commits = await listCommits({ owner, repo, perPage: 30 })
    } catch (e) {
      commitsError = e instanceof Error ? e.message : '加载历史失败'
      commits = []
    } finally {
      commitsLoading = false
    }
  }

  function formatCommitDate(date: string | null): string {
    if (!date) return ''
    try {
      return new Date(date).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' })
    } catch {
      return date
    }
  }

  // ---- 文件树 ----
  async function loadDir(dir: string) {
    filesError = null
    try {
      const entries = await listContents(dir, { owner, repo })
      const node: TreeNode = {
        dirs: entries
          .filter((e) => e.type === 'dir')
          .sort((a, b) => a.name.localeCompare(b.name)),
        files: entries
          .filter((e) => e.type === 'file')
          .sort((a, b) => a.name.localeCompare(b.name)),
      }
      tree = new Map(tree).set(dir, node)
    } catch (e) {
      filesError = e instanceof Error ? e.message : '加载目录失败'
    }
  }

  function toggleDir(dir: string) {
    const next = new Set(expanded)
    if (next.has(dir)) {
      next.delete(dir)
    } else {
      next.add(dir)
      // 首次展开懒加载
      if (!tree.has(dir)) void loadDir(dir)
    }
    expanded = next
  }

  async function selectFile(path: string) {
    selectedFile = path
    fileLoading = true
    fileContent = ''
    try {
      fileContent = await getFileText(path, { owner, repo })
    } catch (e) {
      fileContent = `（加载失败：${e instanceof Error ? e.message : '未知错误'}）`
    } finally {
      fileLoading = false
    }
  }

  /** 计算目录的全路径前缀展示。 */
  function dirLabel(dir: string): string {
    if (dir === '') return '根目录'
    return dir.split('/').pop() ?? dir
  }

  // ---- 变更（仅主仓库）----
  async function loadChanges() {
    changesLoading = true
    try {
      changes = await vfs.dirtyFiles()
    } catch {
      changes = []
    } finally {
      changesLoading = false
    }
  }

  function changeKind(change: VfsNode): 'add' | 'del' | 'mod' {
    if (change.origin === 'local') return 'add'
    if (change.content === null) return 'del'
    return 'mod'
  }

  async function handleCommit() {
    if (changes.length === 0) {
      notifyWarning('没有待提交的变更')
      return
    }
    const msg = message.trim() || `更新 ${changes.length} 个文件`
    committing = true
    try {
      // 经 GitService 提交（带鉴权守卫 + 类型化错误 + 活动日志）
      const git = await gaubeeos.requestAppService('git')
      const sha = await git.commit(msg, 'github')
      notifySuccess(`已提交（${sha.slice(0, 7)}）`)
      message = ''
      await loadChanges()
    } catch (e) {
      handlePublishError(e, navController)
    } finally {
      committing = false
    }
  }

  async function handleRevert(path: string) {
    await vfsStore.revert(path)
    await loadChanges()
  }

  // ---- 日志 ----
  function formatActivityTime(ts: number): string {
    return new Date(ts).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' })
  }

  function actionLabel(a: GitActivity['action']): string {
    return a === 'commit' ? '提交' : a === 'sync' ? '同步' : '撤销'
  }

  function actionTone(a: GitActivity['action']): 'default' | 'secondary' | 'outline' {
    return a === 'commit' ? 'default' : a === 'sync' ? 'secondary' : 'outline'
  }

  /** 刷新当前 Tab（根据 tab 值加载对应数据）。 */
  function refreshTab(tab: string) {
    if (tab === 'history') void loadCommits()
    else if (tab === 'files') {
      tree = new Map()
      expanded = new Set([''])
      void loadDir('')
    } else if (tab === 'changes') void loadChanges()
  }
</script>

<div class="mx-auto max-w-4xl space-y-4 p-4 sm:p-6">
  <!-- 标题 -->
  <div class="flex items-center gap-2">
    <GitHubMark class="size-5" />
    <h1 class="text-2xl font-semibold">Github</h1>
    <span class="text-muted-foreground font-mono text-sm">{owner}/{repo}</span>
    {#if isMainRepo}
      <Badge variant="default" class="text-[10px]">主仓库</Badge>
    {:else}
      <Badge variant="secondary" class="text-[10px]">只读</Badge>
    {/if}
  </div>

  <!-- 仓库选择器 -->
  <Card.Root>
    <Card.Content class="flex flex-wrap items-center gap-2 pt-5">
      <span class="text-muted-foreground text-sm">浏览仓库</span>
      <Input
        bind:value={ownerInput}
        placeholder="owner"
        class="w-32 font-mono text-sm"
        onkeydown={(e) => { if (e.key === 'Enter') applyRepo() }}
      />
      <span class="text-muted-foreground">/</span>
      <Input
        bind:value={repoInput}
        placeholder="repo"
        class="w-44 font-mono text-sm"
        onkeydown={(e) => { if (e.key === 'Enter') applyRepo() }}
      />
      <Button size="sm" onclick={applyRepo} class="gap-1">
        <ChevronRightIcon class="size-4" />
        切换
      </Button>
      {#if !isMainRepo}
        <Button
          size="sm"
          variant="ghost"
          class="ml-auto text-xs"
          onclick={() => { ownerInput = OWNER; repoInput = REPO; owner = OWNER; repo = REPO; commits = []; tree = new Map(); expanded = new Set(['']); selectedFile = null; void loadCommits(); void loadDir(''); }}
        >
          回到主仓库
        </Button>
      {/if}
    </Card.Content>
  </Card.Root>

  <!-- 主体 Tab -->
  <Tabs.Root value="history" class="w-full">
    <Tabs.List class="grid w-full grid-cols-4">
      <Tabs.Trigger value="history" class="gap-1.5"><HistoryIcon class="size-4" />历史</Tabs.Trigger>
      <Tabs.Trigger value="files" class="gap-1.5"><FolderIcon class="size-4" />文件</Tabs.Trigger>
      <Tabs.Trigger value="changes" class="gap-1.5"><FilePenIcon class="size-4" />变更</Tabs.Trigger>
      <Tabs.Trigger value="log" class="gap-1.5"><ScrollTextIcon class="size-4" />日志</Tabs.Trigger>
    </Tabs.List>

    <!-- 历史 -->
    <Tabs.Content value="history">
      <Card.Root>
        <Card.Header class="flex-row items-center justify-between space-y-0">
          <Card.Title class="flex items-center gap-2 text-base">
            <HistoryIcon class="size-4" />
            提交历史
          </Card.Title>
          <Button variant="outline" size="sm" onclick={() => loadCommits()} disabled={commitsLoading} class="gap-1">
            <RefreshCwIcon class="size-3 {commitsLoading ? 'animate-spin' : ''}" />
            刷新
          </Button>
        </Card.Header>
        <Card.Content>
          {#if commitsLoading && commits.length === 0}
            {#each Array(4) as _}
              <Skeleton class="mb-2 h-12" />
            {/each}
          {:else if commitsError}
            <p class="text-destructive text-sm">{commitsError}</p>
          {:else if commits.length === 0}
            <p class="text-muted-foreground py-4 text-center text-sm">暂无提交</p>
          {:else}
            <div class="space-y-1">
              {#each commits as c (c.sha)}
                <div class="hover:bg-accent flex items-start gap-3 rounded-md p-2 transition-colors">
                  <div class="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-full font-mono text-[10px]">
                    {c.sha.slice(0, 7)}
                  </div>
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-medium">{c.message}</p>
                    <p class="text-muted-foreground text-xs">
                      {c.login ?? c.author?.name ?? 'unknown'}
                      {#if c.author?.date}· {formatCommitDate(c.author.date)}{/if}
                    </p>
                    {#if c.body}
                      <p class="text-muted-foreground mt-0.5 line-clamp-2 text-xs whitespace-pre-wrap">{c.body}</p>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </Card.Content>
      </Card.Root>
    </Tabs.Content>

    <!-- 文件 -->
    <Tabs.Content value="files">
      <Card.Root>
        <Card.Header class="flex-row items-center justify-between space-y-0">
          <Card.Title class="flex items-center gap-2 text-base">
            <FolderIcon class="size-4" />
            文件浏览
          </Card.Title>
          <Button variant="outline" size="sm" onclick={() => refreshTab('files')} class="gap-1">
            <RefreshCwIcon class="size-3" />
            刷新
          </Button>
        </Card.Header>
        <Card.Content>
          {#if filesError}
            <p class="text-destructive text-sm">{filesError}</p>
          {/if}
          <div class="grid gap-4 md:grid-cols-[minmax(0,280px)_1fr]">
            <!-- 文件树 -->
            <div class="border-border max-h-[60vh] overflow-auto rounded border p-1 text-sm">
              {#each [...expanded].sort() as dir (dir)}
                {@const node = tree.get(dir)}
                <div class="mb-1">
                  <button
                    class="text-muted-foreground hover:text-foreground flex w-full items-center gap-1 rounded px-1 py-0.5 text-xs font-medium"
                    onclick={() => toggleDir(dir)}
                  >
                    <ChevronRightIcon class="size-3 {expanded.has(dir) ? 'rotate-90' : ''} transition-transform" />
                    {dirLabel(dir)}
                  </button>
                  {#if node}
                    <div class="ml-3 border-l border-border pl-2">
                      {#each node.dirs as d (d.path)}
                        <button
                          class="hover:bg-accent flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-xs"
                          onclick={() => toggleDir(d.path)}
                        >
                          <FolderIcon class="size-3.5 shrink-0 text-amber-500" />
                          <span class="truncate">{d.name}</span>
                          {#if expanded.has(d.path) && !tree.has(d.path)}
                            <RefreshCwIcon class="size-3 animate-spin" />
                          {/if}
                        </button>
                      {/each}
                      {#each node.files as f (f.path)}
                        <button
                          class="hover:bg-accent flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-xs {selectedFile === f.path ? 'bg-accent' : ''}"
                          onclick={() => selectFile(f.path)}
                        >
                          <FileTextIcon class="size-3.5 shrink-0 text-muted-foreground" />
                          <span class="truncate">{f.name}</span>
                        </button>
                      {/each}
                    </div>
                  {:else if expanded.has(dir) && dir !== ''}
                    <div class="text-muted-foreground ml-3 pl-2 text-xs">加载中…</div>
                  {/if}
                </div>
              {/each}
            </div>
            <!-- 文件内容 -->
            <div class="border-border min-h-[200px] rounded border p-2">
              {#if !selectedFile}
                <p class="text-muted-foreground py-8 text-center text-sm">选择左侧文件查看内容</p>
              {:else if fileLoading}
                <Skeleton class="h-40" />
              {:else}
                <div class="mb-2 flex items-center gap-2 border-b border-border pb-1">
                  <FileTextIcon class="size-3.5 text-muted-foreground" />
                  <code class="text-xs">{selectedFile}</code>
                </div>
                <pre class="bg-muted/50 max-h-[55vh] overflow-auto rounded p-2 text-xs leading-relaxed whitespace-pre-wrap">{fileContent}</pre>
              {/if}
            </div>
          </div>
        </Card.Content>
      </Card.Root>
    </Tabs.Content>

    <!-- 变更（仅主仓库）-->
    <Tabs.Content value="changes">
      <Card.Root>
        <Card.Header class="flex-row items-center justify-between space-y-0">
          <Card.Title class="flex items-center gap-2 text-base">
            <FilePenIcon class="size-4" />
            未提交变更
          </Card.Title>
          <Button variant="outline" size="sm" onclick={loadChanges} disabled={changesLoading} class="gap-1">
            <RefreshCwIcon class="size-3 {changesLoading ? 'animate-spin' : ''}" />
            刷新
          </Button>
        </Card.Header>
        <Card.Content>
          {#if !isMainRepo}
            <p class="text-muted-foreground py-4 text-center text-sm">
              变更提交仅支持主仓库 {OWNER}/{REPO}。
              <button class="text-primary underline" onclick={() => { ownerInput = OWNER; repoInput = REPO; owner = OWNER; repo = REPO; void loadChanges(); }}>
                切回主仓库
              </button>
            </p>
          {:else if changesLoading}
            <Skeleton class="h-16" />
          {:else if changes.length === 0}
            <p class="text-muted-foreground py-4 text-center text-sm">工作区干净，没有未提交的修改。</p>
          {:else}
            <div class="space-y-2">
              {#each changes as change (change.path)}
                {@const kind = changeKind(change)}
                <div class="flex items-center gap-2 rounded border border-border p-2">
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
              {/each}
            </div>
            <!-- commit 区 -->
            <div class="border-border mt-4 border-t pt-3">
              <label for="gh-commit-msg" class="mb-1.5 block text-sm font-medium">提交信息</label>
              <Input
                id="gh-commit-msg"
                type="text"
                value={message}
                oninput={(e) => (message = e.currentTarget.value)}
                placeholder="描述本次变更（可选）"
                class="mb-2"
              />
              <Button onclick={handleCommit} disabled={committing} class="gap-1">
                <GitCommitHorizontalIcon class="size-4" />
                {committing ? '提交中…' : `提交 ${changes.length} 个变更到 GitHub`}
              </Button>
            </div>
          {/if}
        </Card.Content>
      </Card.Root>
    </Tabs.Content>

    <!-- 日志 -->
    <Tabs.Content value="log">
      <Card.Root>
        <Card.Header>
          <Card.Title class="flex items-center gap-2 text-base">
            <ScrollTextIcon class="size-4" />
            活动日志
            <span class="text-muted-foreground text-sm font-normal">（{activities.length}）</span>
          </Card.Title>
        </Card.Header>
        <Card.Content>
          {#if activities.length === 0}
            <p class="text-muted-foreground py-4 text-center text-sm">暂无活动记录</p>
          {:else}
            <div class="space-y-1">
              {#each activities as a (a.id)}
                <div class="hover:bg-accent flex items-start gap-3 rounded-md p-2 transition-colors">
                  <div class="flex size-7 shrink-0 items-center justify-center rounded-full">
                    {#if a.action === 'commit'}
                      <GitCommitHorizontalIcon class="size-4 text-muted-foreground" />
                    {:else if a.action === 'sync'}
                      <RefreshCwIcon class="size-4 text-muted-foreground" />
                    {:else}
                      <Undo2Icon class="size-4 text-muted-foreground" />
                    {/if}
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                      <Badge variant={actionTone(a.action)} class="text-[10px]">{actionLabel(a.action)}</Badge>
                      <span class="text-sm font-medium">{a.actor}</span>
                      <span class="text-muted-foreground font-mono text-xs">{a.repo}</span>
                      <span class="text-muted-foreground ml-auto text-xs">{formatActivityTime(a.timestamp)}</span>
                    </div>
                    {#if a.details.message}
                      <p class="text-foreground mt-0.5 truncate text-xs">{a.details.message}</p>
                    {/if}
                    {#if a.details.sha}
                      <p class="text-muted-foreground mt-0.5 font-mono text-xs">sha: {a.details.sha.slice(0, 7)}</p>
                    {/if}
                    {#if a.details.files && a.details.files.length > 0}
                      <p class="text-muted-foreground mt-0.5 truncate text-xs">
                        {a.details.files.length} 个文件：{a.details.files.slice(0, 3).join(', ')}{a.details.files.length > 3 ? '…' : ''}
                      </p>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </Card.Content>
      </Card.Root>
    </Tabs.Content>
  </Tabs.Root>
</div>
