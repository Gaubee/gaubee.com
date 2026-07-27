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
  import { navStore } from '$lib/nav/nav.svelte'
  import { useParams, useSearch } from '$lib/router'
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
  import CommitDetailPanel from './CommitDetailPanel.svelte'
  import { diffLines } from '$lib/utils/diff'
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
  import CircleDotIcon from '@lucide/svelte/icons/circle-dot'
  import CheckCircle2Icon from '@lucide/svelte/icons/check-circle-2'
  import MessageCircleIcon from '@lucide/svelte/icons/message-circle'
  import XIcon from '@lucide/svelte/icons/x'
  import { labelStyleString } from '$lib/utils/label-color'

  // ---- 路由参数（2026-07-27 重构：useParams/useSearch 返回 getter，需 $derived 包装）----
  type RepoDetailParams = { owner: string; repo: string };
  type RepoDetailSearch = {
    tab: 'files' | 'history' | 'changes' | 'issues' | 'log';
    sha?: string;
    file?: string;
    issue?: number;
    change?: string;
    activity?: string;
    ref?: string;
  };
  // 关键：useParams/useSearch 返回 getter，用 $derived 包成响应式快照，
  // 后续读取 .tab/.sha 等字段自动响应 URL 变化。
  // 旧 bug：直接拿快照值，导致 ?sha=xxx 切换 commit 不重新加载（需刷新才行）。
  const getParams = useParams<RepoDetailParams>();
  const getSearch = useSearch<RepoDetailSearch>();
  const params = $derived(getParams?.());
  const search = $derived(getSearch?.());

  const owner = $derived(params?.owner ?? '');
  const repo = $derived(params?.repo ?? '');

  const isMainRepo = $derived(owner === OWNER && repo === REPO)

  // ---- Tab 路由化（URL query 参数驱动，已通过 search schema parse）----
  const navState = $derived(navStore.current)
  /** 当前 Tab（已 parse，默认 files 由 schema 保证）。 */
  const activeTab = $derived(search?.tab ?? 'files')
  /** 各选中项从已 parse 的 search 读取（刷新/前进后退保持）。 */
  const selectedFile = $derived(search?.file ?? '')
  const selectedCommitSha = $derived(search?.sha)
  const selectedIssue = $derived(search?.issue ?? null)
  const selectedChangePath = $derived(search?.change)
  const selectedActivityId = $derived(search?.activity)
  /** 文件 Tab 的 git ref（commit SHA/分支名），用于按历史版本浏览文件树和文件内容。 */
  const fileRef = $derived(search?.ref)

  /** 详情页 base path（owner/repo，不含 query）。 */
  const basePath = $derived(navState.mainLocation.pathname)

  /** 切 Tab（REPLACE 不入历史栈）。 */
  function switchTab(tab: string) {
    navController.navigateMain(`${basePath}?tab=${tab}`, 'REPLACE')
  }
  /** 选中项（PUSH 入历史栈，可后退）。更新 query 时保留 tab + ref（文件按 commit 访问上下文）。 */
  function navigateSelect(tab: string, key: string, value: string) {
    const sp = new URLSearchParams({ tab, [key]: value })
    // 文件 Tab 的 ref 参数需要跨选中项保留（同一个 commit 下浏览不同文件）
    if (tab === 'files' && fileRef) sp.set('ref', fileRef)
    navController.navigateMain(`${basePath}?${sp.toString()}`)
  }

  // ---- 仓库元数据 ----
  let repoInfo = $state<RepoSummary | null>(null)
  let repoInfoLoading = $state(false)

  // ---- 文件树 + 内容 ----
  let tree = $state<Map<string, TreeNode>>(new Map())
  let expanded = $state<Set<string>>(new Set(['']))
  let loadingDirs = $state<Set<string>>(new Set())
  /** 移动端文件树浮层开关（桌面端用双栏 grid，不用此浮层）。 */
  let fileTreeSheetOpen = $state(false)

  // ---- 历史 ----
  let commits = $state<CommitInfo[]>([])
  let commitsLoading = $state(false)
  let commitsError = $state<string | null>(null)
  /** 移动端 commit 列表浮层。 */
  let commitListSheetOpen = $state(false)

  // ---- 变更（仅主仓库）----
  let changes = $state<VfsNode[]>([])
  let changesLoading = $state(false)
  let commitMessage = $state('')
  let committing = $state(false)
  /** 移动端变更列表浮层。 */
  let changeListSheetOpen = $state(false)

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
  /** 三种列表模式：open（默认）/ closed / search（关键词搜索结果）。 */
  type IssueListMode = 'open' | 'closed' | 'search'
  let issues = $state<IssueSummary[]>([])
  let issuesLoading = $state(false)
  let issuesError = $state<string | null>(null)
  /** 当前列表模式（控制 tab 高亮 + 数据源）。 */
  let issueMode = $state<IssueListMode>('open')
  /** open/closed 计数（进入页面时并行加载一次，用 search API 拿准确总数）。 */
  let openCount = $state<number | null>(null)
  let closedCount = $state<number | null>(null)
  let countsLoading = $state(false)
  let issueSearchInput = $state('')
  /** 移动端 issue 列表浮层开关。 */
  let issueListSheetOpen = $state(false)

  // ---- 日志 ----
  const activities = $derived(
    activityLog.activities.filter((a) => a.repo === `${owner}/${repo}`),
  )
  /** 移动端活动列表浮层。 */
  let activityListSheetOpen = $state(false)
  /** 派生：选中的活动对象。 */
  const selectedActivity = $derived(
    selectedActivityId ? activities.find((a) => a.id === selectedActivityId) ?? null : null,
  )

  /** 派生：选中变更文件的 diff 行（变更 Tab 右栏用）。 */
  const selectedChangeNode = $derived(
    selectedChangePath ? changes.find((c) => c.path === selectedChangePath) ?? null : null,
  )
  const selectedChangeDiff = $derived(
    selectedChangeNode ? diffLines(
      typeof selectedChangeNode.baseContent === 'string' ? selectedChangeNode.baseContent : '',
      selectedChangeNode.content ?? '',
    ) : [],
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
    if (!o || !r) return  // owner/repo 未就绪时跳过（避免空字符串触发无效加载）
    untrack(() => void loadAll(o, r))
  })

  // auth 就绪后重试 README 自动选中（修复整页刷新时序 bug）。
  // 场景：整页刷新时 authStore.refresh() 是 async，组件挂载时 isAuthenticated=false，
  // fetchReadme 走匿名分支受 60/h 限速失败；auth 就绪后需重新尝试。
  // 仅在 files Tab + 未选中文件 + 无 fileRef 时重试（与 autoSelectReadme 条件一致）。
  $effect(() => {
    const authed = accountService.state.authenticated
    const loaded = accountService.state.loaded
    const o = owner
    const r = repo
    if (!authed || !loaded || !o || !r) return
    if (activeTab !== 'files' || selectedFile || fileRef) return
    untrack(() => void autoSelectReadme(o, r))
  })

  // fileRef（commit SHA）变化时清空文件树重新加载（不同 commit 的目录结构不同）。
  $effect(() => {
    const ref = fileRef
    untrack(() => {
      tree = new Map()
      expanded = new Set([''])
      loadingDirs = new Set()
      void loadDir('', owner, repo)
    })
  })

  async function loadAll(o: string, r: string) {
    void loadRepoInfo(o, r)
    void autoSelectReadme(o, r)
    void loadCommits(o, r)
    void loadDir('', o, r)
    if (o === OWNER && r === REPO) void loadChanges()
    void loadIssues(o, r)
    void loadIssueCounts(o, r)
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
        // 仅在 files Tab 且未选中文件且无 fileRef（默认分支）时自动选中 README
        if (activeTab === 'files' && !selectedFile && !fileRef) {
          navigateSelect('files', 'file', result.path)
        }
      }
    } catch {
      // 无 README 或加载失败，静默（selectedFile 保持空，显示提示）
    }
  }

  // ---- 文件树 ----
  async function loadDir(dir: string, o: string, r: string) {
    loadingDirs = new Set(loadingDirs).add(dir)
    try {
      const entries = await listContents(dir, { owner: o, repo: r, ref: fileRef ?? undefined })
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
    navigateSelect('files', 'file', path)
    // 移动端：选中文件后关闭文件树浮层。
    queueMicrotask(() => {
      fileTreeSheetOpen = false
    })
  }

  /** 清除 fileRef，回到默认分支（清掉 URL 的 ref 参数，保留当前 tab + file）。 */
  function clearFileRef() {
    const sp = new URLSearchParams({ tab: 'files' })
    if (selectedFile) sp.set('file', selectedFile)
    navController.navigateMain(`${basePath}?${sp.toString()}`)
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
  /** 加载 open/closed 列表（按 mode 决定 state 参数）。
   *  search 模式走 handleIssueSearch，不经过这里。 */
  async function loadIssues(o: string, r: string) {
    if (issueMode === 'search') return // search 模式由 handleIssueSearch 负责
    issuesLoading = true
    issuesError = null
    try {
      const state = issueMode === 'closed' ? 'closed' : 'open'
      issues = await listIssues(o, r, { state, perPage: 30 })
    } catch (e) {
      issuesError = e instanceof Error ? e.message : '加载 Issues 失败'
      issues = []
    } finally {
      issuesLoading = false
    }
  }

  /** 并行加载 open/closed 计数（用 search API 拿准确 total_count）。
   *  进入页面或 owner/repo 变化时调用一次。 */
  async function loadIssueCounts(o: string, r: string) {
    countsLoading = true
    try {
      const [open, closed] = await Promise.all([
        searchIssues(o, r, 'is:open', { perPage: 1 }),
        searchIssues(o, r, 'is:closed', { perPage: 1 }),
      ])
      openCount = open.total
      closedCount = closed.total
    } catch {
      // 计数加载失败静默（tab 仍可用，只是不显示数字）
      openCount = null
      closedCount = null
    } finally {
      countsLoading = false
    }
  }

  /** 切换列表模式（open/closed/search）。 */
  function setIssueMode(mode: IssueListMode) {
    issueMode = mode
    if (mode !== 'search') {
      void loadIssues(owner, repo)
    }
  }

  /** 清除搜索，回到之前的 tab（open 或 closed）。 */
  function clearIssueSearch() {
    issueSearchInput = ''
    issueMode = issueMode === 'search' ? 'open' : issueMode
    void loadIssues(owner, repo)
  }

  async function handleIssueSearch() {
    const q = issueSearchInput.trim()
    if (!q) {
      clearIssueSearch()
      return
    }
    issueMode = 'search'
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
    navigateSelect('issues', 'issue', String(num))
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

  /** 相对时间格式化（GitHub 风格："3 天前" / "2 小时前" / "刚刚"）。
   *  超过 30 天回退到绝对日期（"2026/6/15"）。 */
  function formatTimeAgo(iso: string | null | undefined): string {
    if (!iso) return ''
    try {
      const then = new Date(iso).getTime()
      const now = Date.now()
      const diff = now - then
      const min = 60 * 1000
      const hour = 60 * min
      const day = 24 * hour
      const month = 30 * day
      if (diff < min) return '刚刚'
      if (diff < hour) return `${Math.floor(diff / min)} 分钟前`
      if (diff < day) return `${Math.floor(diff / hour)} 小时前`
      if (diff < month) return `${Math.floor(diff / day)} 天前`
      return new Date(iso).toLocaleDateString('zh-CN', { dateStyle: 'short' })
    } catch {
      return iso
    }
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
    <Tabs.Root value={activeTab} onValueChange={(v) => switchTab(v)} class="w-full">
      <Tabs.List class="repo-tabs grid w-full grid-cols-5">
        <Tabs.Trigger value="files" class="gap-1.5"><FolderIcon class="size-4" /><span class="tab-label">文件</span></Tabs.Trigger>
        <Tabs.Trigger value="history" class="gap-1.5"><HistoryIcon class="size-4" /><span class="tab-label">历史</span></Tabs.Trigger>
        <Tabs.Trigger value="changes" class="gap-1.5"><FilePenIcon class="size-4" /><span class="tab-label">变更</span></Tabs.Trigger>
        <Tabs.Trigger value="issues" class="gap-1.5"><BugIcon class="size-4" /><span class="tab-label">Issues</span></Tabs.Trigger>
        <Tabs.Trigger value="log" class="gap-1.5"><ScrollTextIcon class="size-4" /><span class="tab-label">日志</span></Tabs.Trigger>
      </Tabs.List>

      <!-- 文件 + README -->
      <Tabs.Content value="files" class="p-4">
        <!-- ref 状态条：当 fileRef 存在（按 commit/tag 查看历史版本）时显示。
             轻量 inline 风格，提示用户当前不在默认分支，提供「返回默认分支」按钮。
             参考 GitHub "You are viewing at commit xxx" 提示条。 -->
        {#if fileRef}
          {@const isSha = /^[0-9a-f]{40}$/i.test(fileRef) || /^[0-9a-f]{7,}$/i.test(fileRef)}
          {@const refLabel = isSha && fileRef.length > 12 ? fileRef.slice(0, 7) : fileRef}
          <div class="bg-primary/5 border-primary/20 text-primary mb-3 flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs">
            <GitCommitHorizontalIcon class="size-3.5 shrink-0" />
            <span>历史版本</span>
            <code class="font-mono font-semibold">{refLabel}</code>
            <button
              type="button"
              onclick={clearFileRef}
              class="text-primary/70 hover:text-primary hover:bg-primary/10 ml-auto inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] transition-colors"
            >
              <ArrowLeftIcon class="size-3" />
              返回默认分支
            </button>
          </div>
        {/if}
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
              commitSha={fileRef ?? ''}
              onopenfiletree={() => (fileTreeSheetOpen = true)}
              onopenfile={(p) => selectFile(p)}
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

      <!-- 历史（双栏：commit 列表左 sticky + CommitDetailPanel 右展开）-->
      <Tabs.Content value="history" class="p-4">
        <div class="flex items-center gap-2 pb-2 md:hidden">
          <Button size="sm" variant="default" onclick={() => (commitListSheetOpen = true)}>
            <HistoryIcon class="size-4" />
            提交列表
          </Button>
        </div>

        <div class="grid min-w-0 gap-4 md:grid-cols-[minmax(260px,360px)_1fr]">
          {#snippet commitList()}
            {#if commitsLoading && commits.length === 0}
              {#each Array(4) as _}<Skeleton class="mb-2 h-12" />{/each}
            {:else if commitsError}
              <p class="text-destructive p-2 text-sm">{commitsError}</p>
            {:else if commits.length === 0}
              <p class="text-muted-foreground py-4 text-center text-sm">暂无提交</p>
            {:else}
              {#each commits as c (c.sha)}
                <button
                  class="hover:bg-accent flex w-full items-start gap-2 rounded-md p-2 text-left transition-colors {selectedCommitSha === c.sha ? 'bg-accent' : ''}"
                  onclick={() => { navigateSelect('history', 'sha', c.sha); commitListSheetOpen = false }}
                >
                  <div class="bg-muted text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-full font-mono text-[10px]">
                    {c.sha.slice(0, 7)}
                  </div>
                  <div class="min-w-0 flex-1">
                    <p class="truncate text-xs font-medium">{c.message}</p>
                    <p class="text-muted-foreground text-[11px]">
                      {c.login ?? c.author?.name ?? 'unknown'}
                      {#if c.author?.date} · {formatCommitDate(c.author.date)}{/if}
                    </p>
                  </div>
                </button>
              {/each}
            {/if}
          {/snippet}
          <!-- commit 列表左栏 -->
          <div class="max-md:hidden">
            <div class="border-border max-h-[calc(100dvh-12rem)] min-w-0 overflow-auto overscroll-contain rounded border md:sticky md:top-2">
              <div class="border-border sticky top-0 z-[1] bg-background flex items-center justify-between p-2">
                <span class="text-xs font-medium">提交历史</span>
                <Button variant="ghost" size="icon-sm" onclick={() => loadCommits(owner, repo)} disabled={commitsLoading}>
                  <RefreshCwIcon class="size-3 {commitsLoading ? 'animate-spin' : ''}" />
                </Button>
              </div>
              <div class="p-1">
                {@render commitList()}
              </div>
            </div>
          </div>

          <!-- commit 详情右栏 -->
          {#if selectedCommitSha}
            <CommitDetailPanel
              sha={selectedCommitSha}
              {owner}
              {repo}
              onopenhistorylist={() => (commitListSheetOpen = true)}
            />
          {:else}
            <div class="border-border text-muted-foreground flex min-w-0 items-center justify-center rounded border py-12 text-sm">
              选择左侧 commit 查看详情
            </div>
          {/if}

          <!-- 移动端 commit 列表浮层 -->
          <Sheet.Root bind:open={commitListSheetOpen}>
            <Sheet.Content side="bottom" class="max-h-[75dvh] rounded-t-lg p-0 md:hidden" showCloseButton={false}>
              <Sheet.Header class="flex-row items-center justify-between border-b px-4 py-3">
                <Sheet.Title class="flex items-center gap-2 text-sm font-medium">
                  <HistoryIcon class="size-4" />
                  提交历史
                </Sheet.Title>
                <Sheet.Description class="sr-only">浏览提交列表</Sheet.Description>
              </Sheet.Header>
              <div class="max-h-[calc(75dvh-4rem)] overflow-auto overscroll-contain p-2">
                {@render commitList()}
              </div>
            </Sheet.Content>
          </Sheet.Root>
        </div>
      </Tabs.Content>

      <!-- 变更（双栏：dirty 文件列表左 sticky + diff 右展开，仅主仓库）-->
      <Tabs.Content value="changes" class="p-4">
        {#if !isMainRepo}
          <div class="text-muted-foreground py-8 text-center text-sm">
            变更提交仅支持主仓库 {OWNER}/{REPO}。
          </div>
        {:else}
          {#snippet changeList()}
            {#if changesLoading}
              {#each Array(3) as _}<Skeleton class="mb-2 h-12" />{/each}
            {:else if changes.length === 0}
              <p class="text-muted-foreground py-4 text-center text-sm">工作区干净</p>
            {:else}
              {#each changes as change (change.path)}
                {@const kind = changeKind(change)}
                <button
                  class="hover:bg-accent flex w-full items-center gap-2 rounded-md p-2 text-left transition-colors {selectedChangePath === change.path ? 'bg-accent' : ''}"
                  onclick={() => { navigateSelect('changes', 'change', change.path); changeListSheetOpen = false }}
                >
                  {#if kind === 'add'}
                    <FilePlusIcon class="size-4 shrink-0 text-emerald-500" />
                  {:else if kind === 'del'}
                    <FileMinusIcon class="size-4 shrink-0 text-destructive" />
                  {:else}
                    <FilePenIcon class="size-4 shrink-0 text-amber-500" />
                  {/if}
                  <span class="truncate text-xs font-medium">{change.path}</span>
                  <span class="text-muted-foreground text-[10px]">
                    {kind === 'add' ? '新' : kind === 'del' ? '删' : '改'}
                  </span>
                </button>
              {/each}
            {/if}
          {/snippet}

          <div class="flex items-center gap-2 pb-2 md:hidden">
            <Button size="sm" variant="default" onclick={() => (changeListSheetOpen = true)}>
              <FilePenIcon class="size-4" />
              变更列表 ({changes.length})
            </Button>
          </div>

          <div class="grid min-w-0 gap-4 md:grid-cols-[minmax(260px,360px)_1fr]">
            <!-- 变更文件列表左栏 -->
            <div class="max-md:hidden">
              <div class="border-border max-h-[calc(100dvh-12rem)] min-w-0 overflow-auto overscroll-contain rounded border md:sticky md:top-2">
                <div class="border-border sticky top-0 z-[1] bg-background flex items-center justify-between p-2">
                  <span class="text-xs font-medium">变更 ({changes.length})</span>
                  <Button variant="ghost" size="icon-sm" onclick={loadChanges} disabled={changesLoading}>
                    <RefreshCwIcon class="size-3 {changesLoading ? 'animate-spin' : ''}" />
                  </Button>
                </div>
                <div class="p-1">
                  {@render changeList()}
                </div>
                <!-- commit 提交区（左栏底部固定）-->
                {#if changes.length > 0}
                  <div class="border-border border-t p-2">
                    <Input
                      type="text"
                      value={commitMessage}
                      oninput={(e) => (commitMessage = e.currentTarget.value)}
                      placeholder="提交信息"
                      class="mb-2 h-8 text-xs"
                    />
                    <Button size="sm" class="w-full gap-1" onclick={handleCommit} disabled={committing}>
                      <GitCommitHorizontalIcon class="size-3.5" />
                      {committing ? '提交中…' : `提交 ${changes.length} 个变更`}
                    </Button>
                  </div>
                {/if}
              </div>
            </div>

            <!-- 变更 diff 右栏 -->
            {#if selectedChangePath && selectedChangeNode}
              <div class="border-border min-w-0 rounded border">
                <!-- 工具栏：文件路径 + 撤销 -->
                <div class="border-border flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
                  <FilePenIcon class="text-muted-foreground size-3.5 shrink-0" />
                  <span class="text-muted-foreground truncate font-mono text-xs" title={selectedChangePath}>{selectedChangePath}</span>
                  <Button size="icon-sm" variant="ghost" class="ml-auto" onclick={() => selectedChangePath && handleRevert(selectedChangePath)} aria-label="撤销修改">
                    <Undo2Icon class="size-3.5" />
                  </Button>
                </div>
                <!-- diff 渲染 -->
                <div class="max-h-[60vh] overflow-auto p-2">
                  {#if selectedChangeDiff.length > 0}
                    <div class="font-mono text-xs">
                      {#each selectedChangeDiff.slice(0, 100) as line}
                        <div class="flex {line.type === 'add' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : line.type === 'del' ? 'bg-destructive/10 text-destructive' : ''}">
                          <span class="w-4 shrink-0 select-none opacity-50">{line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}</span>
                          <span class="whitespace-pre-wrap break-all">{line.text}</span>
                        </div>
                      {/each}
                      {#if selectedChangeDiff.length > 100}
                        <p class="text-muted-foreground py-1 text-center">…还有 {selectedChangeDiff.length - 100} 行</p>
                      {/if}
                    </div>
                  {:else}
                    <p class="text-muted-foreground py-4 text-center text-xs">无 diff 内容</p>
                  {/if}
                </div>
              </div>
            {:else}
              <div class="border-border text-muted-foreground flex min-w-0 items-center justify-center rounded border py-12 text-sm">
                选择左侧文件查看 diff
              </div>
            {/if}

            <!-- 移动端变更列表浮层 -->
            <Sheet.Root bind:open={changeListSheetOpen}>
              <Sheet.Content side="bottom" class="max-h-[75dvh] rounded-t-lg p-0 md:hidden" showCloseButton={false}>
                <Sheet.Header class="flex-row items-center justify-between border-b px-4 py-3">
                  <Sheet.Title class="flex items-center gap-2 text-sm font-medium">
                    <FilePenIcon class="size-4" />
                    变更列表
                  </Sheet.Title>
                  <Sheet.Description class="sr-only">浏览变更文件</Sheet.Description>
                </Sheet.Header>
                <div class="max-h-[calc(75dvh-4rem)] overflow-auto overscroll-contain p-2">
                  {@render changeList()}
                </div>
              </Sheet.Content>
            </Sheet.Root>
          </div>
        {/if}
      </Tabs.Content>

      <!-- Issues（双栏：列表左 sticky + 内容右展开，移动端列表收进 Sheet）-->
      <Tabs.Content value="issues" class="p-4">
        <div class="grid min-w-0 gap-4 md:grid-cols-[minmax(260px,360px)_1fr]">
          <!-- issue 工具栏 snippet（桌面端左栏 + 移动端 Sheet 共用）：
               Open/Closed tab（带计数）+ 搜索框，或 search 模式下的结果标题 + 清除按钮。 -->
          {#snippet issueToolbar()}
            <div class="bg-muted/30 flex items-center gap-1 border-b px-2 py-1.5">
              {#if issueMode === 'search'}
                <div class="text-muted-foreground flex min-w-0 flex-1 items-center gap-1.5 text-xs">
                  <SearchIcon class="size-3.5 shrink-0" />
                  <span class="truncate">搜索「{issueSearchInput}」</span>
                  {#if !issuesLoading}
                    <span class="opacity-70">· {issues.length} 个结果</span>
                  {/if}
                </div>
                <button
                  type="button"
                  onclick={clearIssueSearch}
                  class="text-muted-foreground hover:text-foreground hover:bg-accent inline-flex size-5 items-center justify-center rounded transition-colors"
                  aria-label="清除搜索"
                  title="清除搜索"
                >
                  <XIcon class="size-3.5" />
                </button>
              {:else}
                <button
                  type="button"
                  onclick={() => setIssueMode('open')}
                  class="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors {issueMode === 'open' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}"
                >
                  <CircleDotIcon class="size-3.5 {issueMode === 'open' ? 'text-emerald-500' : ''}" />
                  Open
                  {#if openCount !== null}
                    <span class="text-muted-foreground tabular-nums opacity-80">{openCount}</span>
                  {/if}
                </button>
                <button
                  type="button"
                  onclick={() => setIssueMode('closed')}
                  class="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors {issueMode === 'closed' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}"
                >
                  <CheckCircle2Icon class="size-3.5 {issueMode === 'closed' ? 'text-purple-500' : ''}" />
                  Closed
                  {#if closedCount !== null}
                    <span class="text-muted-foreground tabular-nums opacity-80">{closedCount}</span>
                  {/if}
                </button>
                <form
                  class="ml-auto flex items-center"
                  onsubmit={(e) => {
                    e.preventDefault()
                    void handleIssueSearch()
                  }}
                >
                  <div class="relative">
                    <SearchIcon class="text-muted-foreground absolute left-2 top-1/2 size-3 -translate-y-1/2" />
                    <Input
                      bind:value={issueSearchInput}
                      placeholder="搜索"
                      class="h-7 w-28 pl-6 pr-1 text-xs"
                    />
                  </div>
                </form>
              {/if}
            </div>
          {/snippet}
          <!-- issue 列表 snippet（桌面端左栏和移动端 Sheet 共用渲染逻辑）-->
          {#snippet issueList()}
            {#if issuesLoading && issues.length === 0}
              {#each Array(4) as _}<Skeleton class="h-14 w-full" />{/each}
            {:else if issuesError}
              <p class="text-destructive px-3 py-4 text-sm">{issuesError}</p>
            {:else if issues.length === 0}
              <p class="text-muted-foreground py-8 text-center text-sm">暂无 Issues</p>
            {:else}
              <!-- GitHub 风格 issue 列表：每行 border-b 分隔，状态图标 + 标题 + 彩色 labels + 元信息 + 评论数 -->
              <div class="divide-border -mt-px divide-y border-b">
                {#each issues as it (it.id)}
                  <button
                    class="hover:bg-accent/50 flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors {selectedIssue === it.number ? 'bg-accent/70' : ''}"
                    onclick={() => openIssue(it.number)}
                  >
                    <!-- 状态图标：open=绿色 CircleDot，closed=紫色 CheckCircle -->
                    {#if it.state === 'open'}
                      <CircleDotIcon class="mt-0.5 size-4 shrink-0 text-emerald-500" />
                    {:else}
                      <CheckCircle2Icon class="mt-0.5 size-4 shrink-0 text-purple-500" />
                    {/if}
                    <!-- 主信息区 -->
                    <div class="min-w-0 flex-1">
                      <!-- 标题 + labels（同一行 flex-wrap，GitHub 风格）-->
                      <div class="flex flex-wrap items-center gap-1.5">
                        <span class="hover:text-primary truncate text-sm font-medium text-foreground underline-offset-2 group-hover:underline">
                          {it.title}
                        </span>
                        {#each it.labels.slice(0, 4) as label}
                          <span
                            class="inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-medium leading-[1.4]"
                            style={labelStyleString(label.color)}
                            title={label.name}
                          >
                            {label.name}
                          </span>
                        {/each}
                      </div>
                      <!-- 元信息：#N opened X ago by user -->
                      <p class="text-muted-foreground mt-0.5 truncate text-xs">
                        #{it.number} {it.state === 'open' ? 'opened' : 'closed'} {formatTimeAgo(it.created_at)} by {it.user.login}
                      </p>
                    </div>
                    <!-- 右侧评论数（GitHub 风格，带气泡图标）-->
                    {#if it.comments > 0}
                      <div class="text-muted-foreground flex shrink-0 items-center gap-1 text-xs">
                        <MessageCircleIcon class="size-3.5" />
                        <span class="tabular-nums">{it.comments}</span>
                      </div>
                    {/if}
                  </button>
                {/each}
              </div>
            {/if}
          {/snippet}
          <!-- issue 列表：桌面端 sticky 左栏（独立滚动），移动端隐藏（用 Sheet 触发）-->
          <div class="max-md:hidden">
            <div class="border-border flex max-h-[calc(100dvh-12rem)] min-w-0 flex-col overflow-hidden rounded border md:sticky md:top-2">
              {@render issueToolbar()}
              <!-- issue 列表项（可滚动区） -->
              <div class="min-h-0 flex-1 overflow-auto">
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
            <Sheet.Content side="bottom" class="flex max-h-[75dvh] flex-col rounded-t-lg p-0 md:hidden" showCloseButton={false}>
              <Sheet.Header class="flex-row items-center justify-between border-b px-4 py-3">
                <Sheet.Title class="flex items-center gap-2 text-sm font-medium">
                  <BugIcon class="size-4" />
                  Issues
                </Sheet.Title>
                <Sheet.Description class="sr-only">浏览 issue 列表，选择查看详情</Sheet.Description>
              </Sheet.Header>
              {@render issueToolbar()}
              <div class="min-h-0 flex-1 overflow-auto overscroll-contain">
                {@render issueList()}
              </div>
            </Sheet.Content>
          </Sheet.Root>
        </div>
      </Tabs.Content>

      <!-- 日志（双栏：活动列表左 sticky + 活动详情右展开）-->
      <Tabs.Content value="log" class="p-4">
        <div class="flex items-center gap-2 pb-2 md:hidden">
          <Button size="sm" variant="default" onclick={() => (activityListSheetOpen = true)}>
            <ScrollTextIcon class="size-4" />
            活动日志 ({activities.length})
          </Button>
        </div>

        <div class="grid min-w-0 gap-4 md:grid-cols-[minmax(260px,360px)_1fr]">
          {#snippet activityList()}
            {#if activities.length === 0}
              <p class="text-muted-foreground py-4 text-center text-sm">暂无活动记录</p>
            {:else}
              {#each activities as a (a.id)}
                <button
                  class="hover:bg-accent flex w-full items-start gap-2 rounded-md p-2 text-left transition-colors {selectedActivityId === a.id ? 'bg-accent' : ''}"
                  onclick={() => { navigateSelect('log', 'activity', a.id); activityListSheetOpen = false }}
                >
                  <div class="flex size-6 shrink-0 items-center justify-center">
                    {#if a.action === 'commit'}
                      <GitCommitHorizontalIcon class="text-muted-foreground size-3.5" />
                    {:else if a.action === 'sync'}
                      <RefreshCwIcon class="text-muted-foreground size-3.5" />
                    {:else}
                      <Undo2Icon class="text-muted-foreground size-3.5" />
                    {/if}
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5">
                      <Badge variant={actionTone(a.action)} class="text-[9px]">{actionLabel(a.action)}</Badge>
                      <span class="truncate text-xs font-medium">{a.actor}</span>
                    </div>
                    {#if a.details.message}
                      <p class="text-muted-foreground truncate text-[11px]">{a.details.message}</p>
                    {/if}
                  </div>
                </button>
              {/each}
            {/if}
          {/snippet}
          <!-- 活动列表左栏 -->
          <div class="max-md:hidden">
            <div class="border-border max-h-[calc(100dvh-12rem)] min-w-0 overflow-auto overscroll-contain rounded border md:sticky md:top-2">
              <div class="border-border bg-background sticky top-0 z-[1] p-2">
                <span class="text-xs font-medium">活动日志 ({activities.length})</span>
              </div>
              <div class="p-1">
                {@render activityList()}
              </div>
            </div>
          </div>

          <!-- 活动详情右栏 -->
          {#if selectedActivity}
            <div class="border-border min-w-0 rounded border">
              <div class="border-border flex items-center gap-2 border-b px-3 py-2">
                {#if selectedActivity.action === 'commit'}
                  <GitCommitHorizontalIcon class="text-muted-foreground size-4" />
                {:else if selectedActivity.action === 'sync'}
                  <RefreshCwIcon class="text-muted-foreground size-4" />
                {:else}
                  <Undo2Icon class="text-muted-foreground size-4" />
                {/if}
                <Badge variant={actionTone(selectedActivity.action)} class="text-[10px]">{actionLabel(selectedActivity.action)}</Badge>
                <span class="text-sm font-medium">{selectedActivity.actor}</span>
                <span class="text-muted-foreground ml-auto text-xs">{formatActivityTime(selectedActivity.timestamp)}</span>
              </div>
              <div class="space-y-3 p-4 text-sm">
                {#if selectedActivity.details.message}
                  <div>
                    <p class="text-muted-foreground mb-0.5 text-xs">提交信息</p>
                    <p class="font-medium">{selectedActivity.details.message}</p>
                  </div>
                {/if}
                {#if selectedActivity.details.sha}
                  <div>
                    <p class="text-muted-foreground mb-0.5 text-xs">Commit SHA</p>
                    <code class="bg-muted rounded px-1.5 py-0.5 font-mono text-xs">{selectedActivity.details.sha.slice(0, 7)}</code>
                  </div>
                {/if}
                {#if selectedActivity.details.files && selectedActivity.details.files.length > 0}
                  <div>
                    <p class="text-muted-foreground mb-1 text-xs">影响文件 ({selectedActivity.details.files.length})</p>
                    <div class="space-y-0.5">
                      {#each selectedActivity.details.files as filePath}
                        <code class="bg-muted block truncate rounded px-1.5 py-0.5 font-mono text-xs">{filePath}</code>
                      {/each}
                    </div>
                  </div>
                {/if}
              </div>
            </div>
          {:else}
            <div class="border-border text-muted-foreground flex min-w-0 items-center justify-center rounded border py-12 text-sm">
              选择左侧活动查看详情
            </div>
          {/if}

          <!-- 移动端活动列表浮层 -->
          <Sheet.Root bind:open={activityListSheetOpen}>
            <Sheet.Content side="bottom" class="max-h-[75dvh] rounded-t-lg p-0 md:hidden" showCloseButton={false}>
              <Sheet.Header class="flex-row items-center justify-between border-b px-4 py-3">
                <Sheet.Title class="flex items-center gap-2 text-sm font-medium">
                  <ScrollTextIcon class="size-4" />
                  活动日志
                </Sheet.Title>
                <Sheet.Description class="sr-only">浏览活动列表</Sheet.Description>
              </Sheet.Header>
              <div class="max-h-[calc(75dvh-4rem)] overflow-auto overscroll-contain p-2">
                {@render activityList()}
              </div>
            </Sheet.Content>
          </Sheet.Root>
        </div>
      </Tabs.Content>
    </Tabs.Root>
  </div>
</div>
