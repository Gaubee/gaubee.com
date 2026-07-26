<!--
	RepoDetailView：仓库详情页（GithubApp /app/github/repo/{owner}/{repo}）。

	布局：
	- 顶部元数据栏：返回 + owner/repo + 收藏星标 + 仓库统计（star/fork/语言/更新时间）+ GitHub 外链。
	- Tab 区：文件（含 README）/ 历史 / 变更（仅主仓库）/ Issues / 日志。
	  - 文件 Tab（默认）：左侧递归文件树（RepoFileTree，修复扁平遍历 BUG）+ 右侧 README 渲染。
	    点击文件 → FilePreviewDialog。
	  - 历史 Tab：listCommits REST API。
	  - 变更 Tab：仅主仓库（vfsStore dirty + gitService.commit）；其它仓库只读提示。
	  - Issues Tab：列表（sticky 左栏）+ IssueContentPanel（详情+评论+编辑器）；移动端列表收进 Sheet。
	  - 日志 Tab：activityLog 过滤当前 repo。

	状态：本组件由 GithubView（tabView 常驻）按 pathname 分发渲染，
	owner/repo 变化时通过 $effect 重新加载所有数据。
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { gaubeeos } from '$lib/os/services'
  import { handlePublishError } from '$lib/os/services/publish-helper'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { notifySuccess, notifyWarning } from '$lib/apps/builtin/notifications/service.svelte'
  import { accountService } from '$lib/apps/builtin/account/service'
  import {
    listCommits,
    listContents,
    OWNER,
    REPO,
    type CommitInfo,
    type GhContentEntry,
  } from '$lib/github/client'
  import { vfs, vfsStore, type VfsNode } from '$lib/vfs/vfs.svelte'
  import {
    activityLog,
    type GitActivity,
  } from '$lib/apps/installable/github/activity-log.svelte'
  import { repoFavorites } from '$lib/apps/installable/github/favorites.svelte'
  import {
    getRepo,
    listIssues,
    searchIssues,
    type IssueSummary,
    type RepoSummary,
  } from '$lib/apps/installable/github/repo-api'
  import { fetchReadme } from '$lib/apps/installable/github/readme'
  import RepoFileTree, { type TreeNode } from './RepoFileTree.svelte'
  import RepoFileContent from './RepoFileContent.svelte'
  import IssueContentPanel from './IssueContentPanel.svelte'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import { Badge } from '$lib/components/ui/badge'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import * as Tabs from '$lib/components/ui/tabs'
  import * as Card from '$lib/components/ui/card'
  import * as Sheet from '$lib/components/ui/sheet'
  import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left'
  import StarIcon from '@lucide/svelte/icons/star'
  import TagIcon from '@lucide/svelte/icons/tag'
  import GitForkIcon from '@lucide/svelte/icons/git-fork'
  import ExternalLinkIcon from '@lucide/svelte/icons/external-link'
  import HistoryIcon from '@lucide/svelte/icons/history'
  import FolderIcon from '@lucide/svelte/icons/folder'
  import FolderTreeIcon from '@lucide/svelte/icons/folder-tree'
  import FilePenIcon from '@lucide/svelte/icons/file-pen'
  import BugIcon from '@lucide/svelte/icons/bug'
  import ScrollTextIcon from '@lucide/svelte/icons/scroll-text'
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right'
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw'
  import GitCommitHorizontalIcon from '@lucide/svelte/icons/git-commit-horizontal'
  import Undo2Icon from '@lucide/svelte/icons/undo-2'
  import FilePlusIcon from '@lucide/svelte/icons/file-plus'
  import FileMinusIcon from '@lucide/svelte/icons/file-minus'
  import SearchIcon from '@lucide/svelte/icons/search'

  let { owner, repo }: { owner: string; repo: string } = $props()

  const isMainRepo = $derived(owner === OWNER && repo === REPO)

  // ---- 仓库元数据 ----
  let repoInfo = $state<RepoSummary | null>(null)
  let repoInfoLoading = $state(false)

  // ---- 文件树 + 内容 ----
  let tree = $state<Map<string, TreeNode>>(new Map())
  let expanded = $state<Set<string>>(new Set(['']))
  let loadingDirs = $state<Set<string>>(new Set())
  /** 当前选中的文件路径（进详情页自动选中 README）。 */
  let selectedFile = $state('')
  /** 移动端文件树浮层开关（桌面端用双栏 grid，不用此浮层）。 */
  let fileTreeSheetOpen = $state(false)

  // ---- 历史 ----
  let commits = $state<CommitInfo[]>([])
  let commitsLoading = $state(false)
  let commitsError = $state<string | null>(null)

  // ---- 变更（仅主仓库）----
  let changes = $state<VfsNode[]>([])
  let changesLoading = $state(false)
  let commitMessage = $state('')
  let committing = $state(false)

  // ---- 仓库快速搜索（元数据栏，默认限定仓库类型）----
  let repoSearchInput = $state('')
  let repoSearchResults = $state<RepoSummary[] | null>(null)
  let repoSearchLoading = $state(false)

  /** 仓库快速搜索：支持 owner/repo 直跳 或 关键词搜索。 */
  async function handleRepoSearch() {
    const q = repoSearchInput.trim()
    if (!q) {
      repoSearchResults = null
      return
    }
    // owner/repo 格式直接跳转
    const directMatch = q.match(/^([\w.-]+)\/([\w.-]+)$/)
    if (directMatch) {
      navController.navigateMain(`/app/github/repo/${directMatch[1]}/${directMatch[2]}`)
      repoSearchInput = ''
      repoSearchResults = null
      return
    }
    // 关键词搜索仓库（默认限定仓库类型，非 issues/code）
    repoSearchLoading = true
    try {
      const { searchRepos } = await import('$lib/apps/installable/github/repo-api')
      const { items } = await searchRepos(q, { perPage: 10 })
      repoSearchResults = items
    } catch {
      repoSearchResults = []
    } finally {
      repoSearchLoading = false
    }
  }

  // ---- Issues ----
  let issues = $state<IssueSummary[]>([])
  let issuesLoading = $state(false)
  let issuesError = $state<string | null>(null)
  let issueSearchInput = $state('')
  /** 当前选中的 issue 编号（null 时右侧显示提示）。 */
  let selectedIssue = $state<number | null>(null)
  /** 移动端 issue 列表浮层开关。 */
  let issueListSheetOpen = $state(false)

  // ---- 日志 ----
  const activities = $derived(
    activityLog.activities.filter((a) => a.repo === `${owner}/${repo}`),
  )

  // ---- 收藏 ----
  const favorited = $derived(repoFavorites.has(owner, repo))

  onMount(() => {
    void repoFavorites.init()
    void activityLog.init()
  })

  // owner/repo 变化时重新加载所有数据。
  // untrack：数据加载内部的 state 写入（loadingDirs/tree 等）不应建立响应式依赖，
  // 否则 effect 同步栈读取 loadingDirs 后写入会触发自身重跑 → 死循环。
  $effect(() => {
    const o = owner
    const r = repo
    untrack(() => void loadAll(o, r))
  })

  async function loadAll(o: string, r: string) {
    void loadRepoInfo(o, r)
    void autoSelectReadme(o, r)
    void loadCommits(o, r)
    void loadDir('', o, r)
    if (o === OWNER && r === REPO) void loadChanges()
    void loadIssues(o, r)
  }

  // ---- 仓库元数据 ----
  async function loadRepoInfo(o: string, r: string) {
    repoInfoLoading = true
    try {
      repoInfo = await getRepo(o, r)
    } catch {
      repoInfo = null
    } finally {
      repoInfoLoading = false
    }
  }

  // ---- 自动选中 README（进详情页默认展示 README 内容）----
  // 用 fetchReadme 的 /readme 端点获取 README 路径，设为 selectedFile。
  // 实际内容由 RepoFileContent 加载渲染（统一走 getFileText + renderRepoMarkdown）。
  async function autoSelectReadme(o: string, r: string) {
    try {
      const result = await fetchReadme(o, r)
      if (result.path) {
        selectedFile = result.path
      }
    } catch {
      // 无 README 或加载失败，静默（selectedFile 保持空，显示提示）
    }
  }

  // ---- 文件树 ----
  async function loadDir(dir: string, o: string, r: string) {
    loadingDirs = new Set(loadingDirs).add(dir)
    try {
      const entries = await listContents(dir, { owner: o, repo: r })
      const node: TreeNode = {
        dirs: entries.filter((e) => e.type === 'dir').sort((a, b) => a.name.localeCompare(b.name)),
        files: entries.filter((e) => e.type === 'file').sort((a, b) => a.name.localeCompare(b.name)),
      }
      tree = new Map(tree).set(dir, node)
    } catch {
      // 加载失败静默
    } finally {
      const next = new Set(loadingDirs)
      next.delete(dir)
      loadingDirs = next
    }
  }

  function toggleDir(dir: string) {
    const next = new Set(expanded)
    if (next.has(dir)) {
      next.delete(dir)
    } else {
      next.add(dir)
      if (!tree.has(dir)) void loadDir(dir, owner, repo)
    }
    expanded = next
  }

  function selectFile(path: string) {
    selectedFile = path
    // 移动端：选中文件后关闭文件树浮层。
    // 用微任务延迟关闭，避免与 Sheet/Dialog 内部的 click 处理冲突（同步设 false
    // 会被 bits-ui 的 pointerdown/click 交互判定覆盖）。
    queueMicrotask(() => {
      fileTreeSheetOpen = false
    })
  }

  // ---- 历史 ----
  async function loadCommits(o: string, r: string) {
    commitsLoading = true
    commitsError = null
    try {
      commits = await listCommits({ owner: o, repo: r, perPage: 30 })
    } catch (e) {
      commitsError = e instanceof Error ? e.message : '加载历史失败'
      commits = []
    } finally {
      commitsLoading = false
    }
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
    const msg = commitMessage.trim() || `更新 ${changes.length} 个文件`
    committing = true
    try {
      const git = await gaubeeos.requestAppService('git')
      const sha = await git.commit(msg, 'github')
      notifySuccess(`已提交（${sha.slice(0, 7)}）`)
      commitMessage = ''
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

  // ---- Issues ----
  async function loadIssues(o: string, r: string) {
    issuesLoading = true
    issuesError = null
    try {
      issues = await listIssues(o, r, { state: 'open', perPage: 30 })
    } catch (e) {
      issuesError = e instanceof Error ? e.message : '加载 Issues 失败'
      issues = []
    } finally {
      issuesLoading = false
    }
  }

  async function handleIssueSearch() {
    const q = issueSearchInput.trim()
    if (!q) {
      void loadIssues(owner, repo)
      return
    }
    issuesLoading = true
    issuesError = null
    try {
      const { items } = await searchIssues(owner, repo, q, { perPage: 30 })
      issues = items
    } catch (e) {
      issuesError = e instanceof Error ? e.message : '搜索 Issues 失败'
    } finally {
      issuesLoading = false
    }
  }

  function openIssue(num: number) {
    selectedIssue = num
    // 移动端：选中 issue 后关闭列表浮层
    issueListSheetOpen = false
  }

  // ---- 收藏 ----
  async function toggleFavorite() {
    await repoFavorites.toggle(owner, repo)
  }

  // ---- 格式化辅助 ----
  function fmtNum(n: number): string {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
    return String(n)
  }

  function formatTime(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString('zh-CN')
    } catch {
      return iso
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

  function formatActivityTime(ts: number): string {
    return new Date(ts).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' })
  }

  function actionLabel(a: GitActivity['action']): string {
    return a === 'commit' ? '提交' : a === 'sync' ? '同步' : '撤销'
  }

  function actionTone(a: GitActivity['action']): 'default' | 'secondary' | 'outline' {
    return a === 'commit' ? 'default' : a === 'sync' ? 'secondary' : 'outline'
  }
</script>

<div class="flex h-full flex-col">
  <!-- 顶部元数据栏 -->
  <div class="border-border flex flex-wrap items-center gap-3 border-b px-4 py-3">
    <Button variant="ghost" size="icon-sm" onclick={() => navController.navigateMain('/app/github')} aria-label="返回列表">
      <ArrowLeftIcon class="size-4" />
    </Button>
    <span class="font-mono text-base font-semibold">{owner}/{repo}</span>
    {#if isMainRepo}
      <Badge variant="default" class="text-[10px]">主仓库</Badge>
    {/if}
    <Button
      size="icon-sm"
      variant={favorited ? 'default' : 'ghost'}
      onclick={toggleFavorite}
      aria-label={favorited ? '取消收藏' : '收藏'}
    >
      <TagIcon class="size-4 {favorited ? 'fill-current' : ''}" />
    </Button>
    <!-- 仓库快速搜索（默认限定仓库类型）：owner/repo 直跳 或 关键词搜索 -->
    <form
      class="ml-auto flex items-center gap-1"
      onsubmit={(e) => {
        e.preventDefault()
        void handleRepoSearch()
      }}
    >
      <div class="relative">
        <SearchIcon class="text-muted-foreground absolute left-2 top-1/2 size-3.5 -translate-y-1/2" />
        <Input
          bind:value={repoSearchInput}
          placeholder="owner/repo 或关键词"
          class="h-8 w-32 pl-7 text-xs sm:w-56"
        />
        {#if repoSearchResults && repoSearchResults.length > 0}
          <div class="bg-background absolute right-0 top-9 z-10 max-h-60 w-full overflow-auto rounded-md border border-border shadow-lg">
            {#each repoSearchResults as r (r.id)}
              <button
                type="button"
                class="hover:bg-accent flex w-full flex-col items-start gap-0.5 px-2 py-1.5 text-left text-xs"
                onclick={() => {
                  navController.navigateMain(`/app/github/repo/${r.owner.login}/${r.name}`)
                  repoSearchInput = ''
                  repoSearchResults = null
                }}
              >
                <span class="font-medium">{r.full_name}</span>
                {#if r.description}
                  <span class="text-muted-foreground line-clamp-1">{r.description}</span>
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </form>
    <a
      href={`https://github.com/${owner}/${repo}`}
      target="_blank"
      rel="noopener noreferrer"
      class="text-muted-foreground hover:text-foreground"
      aria-label="在 GitHub 打开"
    >
      <ExternalLinkIcon class="size-4" />
    </a>
  </div>

  <!-- 仓库统计 -->
  {#if repoInfoLoading}
    <div class="border-border border-b px-4 py-2"><Skeleton class="h-6 w-full" /></div>
  {:else if repoInfo}
    <div class="text-muted-foreground flex flex-wrap items-center gap-4 border-b border-border px-4 py-2 text-xs">
      {#if repoInfo.stargazers_count > 0}
        <span class="flex items-center gap-1"><StarIcon class="size-3" />{fmtNum(repoInfo.stargazers_count)}</span>
      {/if}
      {#if repoInfo.forks_count > 0}
        <span class="flex items-center gap-1"><GitForkIcon class="size-3" />{fmtNum(repoInfo.forks_count)}</span>
      {/if}
      {#if repoInfo.language}
        <span>{repoInfo.language}</span>
      {/if}
      {#if repoInfo.archived}
        <Badge variant="outline" class="text-[10px]">已归档</Badge>
      {/if}
      <span>{formatTime(repoInfo.pushed_at)} 更新</span>
    </div>
    {#if repoInfo.description}
      <p class="text-muted-foreground border-b border-border px-4 py-2 text-sm">{repoInfo.description}</p>
    {/if}
  {/if}

  <!-- Tab 区。滚动容器命名 scroll-timeline，供 .repo-tabs 的 scroll-driven 动画引用。 -->
  <div class="repo-tab-scroll min-h-0 flex-1 overflow-auto">
    <Tabs.Root value="files" class="w-full">
      <Tabs.List class="repo-tabs grid w-full grid-cols-5">
        <Tabs.Trigger value="files" class="gap-1.5"><FolderIcon class="size-4" /><span class="tab-label">文件</span></Tabs.Trigger>
        <Tabs.Trigger value="history" class="gap-1.5"><HistoryIcon class="size-4" /><span class="tab-label">历史</span></Tabs.Trigger>
        <Tabs.Trigger value="changes" class="gap-1.5"><FilePenIcon class="size-4" /><span class="tab-label">变更</span></Tabs.Trigger>
        <Tabs.Trigger value="issues" class="gap-1.5"><BugIcon class="size-4" /><span class="tab-label">Issues</span></Tabs.Trigger>
        <Tabs.Trigger value="log" class="gap-1.5"><ScrollTextIcon class="size-4" /><span class="tab-label">日志</span></Tabs.Trigger>
      </Tabs.List>

      <!-- 文件 + README -->
      <Tabs.Content value="files" class="p-4">
        <!-- 桌面端（md+）：双栏 grid（不固定高度，内容自然撑开）。
             fileTree 左栏 sticky + 独立滚动，fileContent 右栏直接展开（由 app 内容区滚动）。
             移动端（<md）：fileTree 收进 Sheet 浮动浮层。 -->
        <div class="grid min-w-0 gap-4 md:grid-cols-[minmax(200px,280px)_1fr]">
          <!-- 文件树：桌面端 sticky 左栏（独立滚动），移动端隐藏（用 Sheet 触发）-->
          <div class="border-border max-h-[calc(100dvh-12rem)] min-w-0 overflow-auto overscroll-contain rounded border p-2 text-sm md:sticky md:top-2 md:block max-md:hidden">
            <RepoFileTree
              dir=""
              label="根目录"
              {tree}
              {expanded}
              {loadingDirs}
              selectedFile={selectedFile}
              ontoggledir={toggleDir}
              onselectfile={selectFile}
            />
          </div>
          <!-- 文件内容（右）：直接展开内容，由 app 内容区滚动 -->
          {#if selectedFile}
            <RepoFileContent
              path={selectedFile}
              {owner}
              {repo}
              branch={repoInfo?.default_branch ?? 'main'}
              onopenfiletree={() => (fileTreeSheetOpen = true)}
            />
          {:else}
            <div class="border-border text-muted-foreground flex min-w-0 items-center justify-center rounded border py-8 text-sm">
              选择左侧文件查看内容
            </div>
          {/if}
        </div>

        <!-- 移动端文件树浮层（桌面端隐藏）：点击文件列表按钮触发，选中文件后自动关闭 -->
        <Sheet.Root bind:open={fileTreeSheetOpen}>
          <Sheet.Content side="bottom" class="max-h-[75dvh] rounded-t-lg p-0 md:hidden" showCloseButton={false}>
            <Sheet.Header class="flex-row items-center justify-between border-b px-4 py-3">
              <Sheet.Title class="flex items-center gap-2 text-sm font-medium">
                <FolderTreeIcon class="size-4" />
                文件列表
              </Sheet.Title>
              <Sheet.Description class="sr-only">浏览仓库文件树，选择文件查看内容</Sheet.Description>
            </Sheet.Header>
            <div class="max-h-[calc(75dvh-4rem)] overflow-auto overscroll-contain p-2 text-sm">
              <RepoFileTree
                dir=""
                label="根目录"
                {tree}
                {expanded}
                {loadingDirs}
                selectedFile={selectedFile}
                ontoggledir={toggleDir}
                onselectfile={selectFile}
              />
            </div>
          </Sheet.Content>
        </Sheet.Root>
      </Tabs.Content>

      <!-- 历史 -->
      <Tabs.Content value="history" class="p-4">
        <Card.Root>
          <Card.Header class="flex-row items-center justify-between space-y-0">
            <Card.Title class="flex items-center gap-2 text-base">
              <HistoryIcon class="size-4" />
              提交历史
            </Card.Title>
            <Button variant="outline" size="sm" onclick={() => loadCommits(owner, repo)} disabled={commitsLoading} class="gap-1">
              <RefreshCwIcon class="size-3 {commitsLoading ? 'animate-spin' : ''}" />
              刷新
            </Button>
          </Card.Header>
          <Card.Content>
            {#if commitsLoading && commits.length === 0}
              {#each Array(4) as _}<Skeleton class="mb-2 h-12" />{/each}
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

      <!-- 变更（仅主仓库）-->
      <Tabs.Content value="changes" class="p-4">
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
                    <Button size="icon-sm" variant="ghost" class="ml-auto" onclick={() => handleRevert(change.path)} aria-label="撤销修改">
                      <Undo2Icon />
                    </Button>
                  </div>
                {/each}
              </div>
              <div class="border-border mt-4 border-t pt-3">
                <label for="gh-commit-msg" class="mb-1.5 block text-sm font-medium">提交信息</label>
                <Input
                  id="gh-commit-msg"
                  type="text"
                  value={commitMessage}
                  oninput={(e) => (commitMessage = e.currentTarget.value)}
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

      <!-- Issues（双栏：列表左 sticky + 内容右展开，移动端列表收进 Sheet）-->
      <Tabs.Content value="issues" class="p-4">
        <div class="grid min-w-0 gap-4 md:grid-cols-[minmax(260px,360px)_1fr]">
          <!-- issue 列表 snippet（桌面端左栏和移动端 Sheet 共用渲染逻辑）-->
          {#snippet issueList()}
            {#if issuesLoading && issues.length === 0}
              {#each Array(4) as _}<Skeleton class="mb-2 h-12" />{/each}
            {:else if issuesError}
              <p class="text-destructive p-2 text-sm">{issuesError}</p>
            {:else if issues.length === 0}
              <p class="text-muted-foreground py-4 text-center text-sm">暂无 Issues</p>
            {:else}
              {#each issues as it (it.id)}
                <button
                  class="hover:bg-accent flex w-full items-start gap-2 rounded-md p-2 text-left transition-colors {selectedIssue === it.number ? 'bg-accent' : ''}"
                  onclick={() => openIssue(it.number)}
                >
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-sm font-medium">{it.title}</p>
                    <p class="text-muted-foreground text-xs">
                      #{it.number} · {it.user.login}
                      {#if it.comments > 0} · {it.comments} 评论{/if}
                    </p>
                    {#if it.labels.length > 0}
                      <div class="mt-1 flex flex-wrap gap-1">
                        {#each it.labels.slice(0, 3) as label}
                          <Badge variant="outline" class="text-[10px]">{label.name}</Badge>
                        {/each}
                      </div>
                    {/if}
                  </div>
                </button>
              {/each}
            {/if}
          {/snippet}
          <!-- issue 列表：桌面端 sticky 左栏（独立滚动），移动端隐藏（用 Sheet 触发）-->
          <div class="max-md:hidden">
            <div class="border-border max-h-[calc(100dvh-12rem)] min-w-0 overflow-auto overscroll-contain rounded border md:sticky md:top-2">
              <!-- 搜索框 -->
              <div class="border-border sticky top-0 z-[1] bg-background p-2">
                <form
                  class="flex items-center gap-1.5"
                  onsubmit={(e) => {
                    e.preventDefault()
                    void handleIssueSearch()
                  }}
                >
                  <div class="relative flex-1">
                    <SearchIcon class="text-muted-foreground absolute left-2.5 top-1/2 size-4 -translate-y-1/2" />
                    <Input
                      bind:value={issueSearchInput}
                      placeholder="搜索 issues"
                      class="h-8 pl-8 text-sm"
                    />
                  </div>
                  <Button type="submit" size="sm" disabled={issuesLoading}>
                    {issuesLoading ? '...' : '搜索'}
                  </Button>
                </form>
              </div>
              <!-- issue 列表项 -->
              <div class="p-1">
                {@render issueList()}
              </div>
            </div>
          </div>

          <!-- issue 内容面板（右）：桌面端展开，移动端让 app 滚动 -->
          {#if selectedIssue !== null}
            <IssueContentPanel
              issueNumber={selectedIssue}
              {owner}
              {repo}
              branch={repoInfo?.default_branch ?? 'main'}
              onopenissuelist={() => (issueListSheetOpen = true)}
            />
          {:else}
            <div class="border-border text-muted-foreground flex min-w-0 flex-col items-center justify-center gap-3 rounded border py-12 text-sm">
              <p>选择 issue 查看详情</p>
              <!-- 移动端：列表入口（桌面端隐藏，左栏可见）-->
              <Button size="sm" variant="default" class="md:hidden" onclick={() => (issueListSheetOpen = true)}>
                <BugIcon class="size-4" />
                查看 Issue 列表
              </Button>
            </div>
          {/if}

          <!-- 移动端 issue 列表浮层（桌面端隐藏）。Sheet 是 portal 浮层，放 grid 内不影响布局。-->
          <Sheet.Root bind:open={issueListSheetOpen}>
            <Sheet.Content side="bottom" class="max-h-[75dvh] rounded-t-lg p-0 md:hidden" showCloseButton={false}>
              <Sheet.Header class="flex-row items-center justify-between border-b px-4 py-3">
                <Sheet.Title class="flex items-center gap-2 text-sm font-medium">
                  <BugIcon class="size-4" />
                  Issues
                </Sheet.Title>
                <Sheet.Description class="sr-only">浏览 issue 列表，选择查看详情</Sheet.Description>
              </Sheet.Header>
              <div class="max-h-[calc(75dvh-4rem)] overflow-auto overscroll-contain p-2">
                {@render issueList()}
              </div>
            </Sheet.Content>
          </Sheet.Root>
        </div>
      </Tabs.Content>

      <!-- 日志 -->
      <Tabs.Content value="log" class="p-4">
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
                        <GitCommitHorizontalIcon class="text-muted-foreground size-4" />
                      {:else if a.action === 'sync'}
                        <RefreshCwIcon class="text-muted-foreground size-4" />
                      {:else}
                        <Undo2Icon class="text-muted-foreground size-4" />
                      {/if}
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <Badge variant={actionTone(a.action)} class="text-[10px]">{actionLabel(a.action)}</Badge>
                        <span class="text-sm font-medium">{a.actor}</span>
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
</div>
