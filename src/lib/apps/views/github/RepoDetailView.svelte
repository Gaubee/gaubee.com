<!--
	RepoDetailView：仓库详情页（GithubApp /app/github/repo/{owner}/{repo}）。

	布局：
	- 顶部元数据栏：返回 + owner/repo + 收藏星标 + 仓库统计（star/fork/语言/更新时间）+ GitHub 外链。
	- Tab 区：文件（含 README）/ 历史 / Issues / 日志。
	  - 文件 Tab（默认）：左侧递归文件树（RepoFileTree，修复扁平遍历 BUG）+ 右侧 README 渲染。
	    点击文件 → FilePreviewDialog。
	  - 历史 Tab：listCommits REST API。
	  - Issues Tab：列表（sticky 左栏）+ IssueContentPanel（详情+评论+编辑器）；移动端列表收进 Sheet。
	  - 日志 Tab：activityLog 过滤当前 repo。

	状态：本组件由 GithubView（tabView 常驻）按 pathname 分发渲染，
	owner/repo 变化时通过 $effect 重新加载所有数据。
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { navStore } from '$lib/nav/nav.svelte'
  import { useParams, useSearch } from '$lib/router'
  import { notifySuccess } from '$lib/apps/builtin/notifications/service.svelte'
  import { accountService } from '$lib/apps/builtin/account/service'
  import {
    listCommits,
    listContents,
    OWNER,
    REPO,
    type CommitInfo,
    type GhContentEntry,
  } from '$lib/github/client'
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
  import RepoEditPermission from './RepoEditPermission.svelte'
  import IssueContentPanel from './IssueContentPanel.svelte'
  import CommitDetailPanel from './CommitDetailPanel.svelte'
  import RepoRefSelector from './RepoRefSelector.svelte'
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
  import SquarePenIcon from '@lucide/svelte/icons/square-pen'
  import HistoryIcon from '@lucide/svelte/icons/history'
  import FolderIcon from '@lucide/svelte/icons/folder'
  import FolderTreeIcon from '@lucide/svelte/icons/folder-tree'
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
  import FilterIcon from '@lucide/svelte/icons/filter'
  import GitBranchIcon from '@lucide/svelte/icons/git-branch'
  import * as Popover from '$lib/components/ui/popover'
  import { labelStyleString } from '$lib/utils/label-color'
  import { createResource } from '$lib/apps/installable/github/state'

  // ---- 路由参数（2026-07-27 重构：useParams/useSearch 返回 getter，需 $derived 包装）----
  type RepoDetailParams = { owner: string; repo: string };
  type RepoDetailSearch = {
    tab: 'files' | 'history' | 'issues' | 'log';
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

  /** 是否主仓库（结构性控制：变更 tab 是否显示/加载）。
   *  大小写不敏感（与 GitHub owner/repo 行为一致；编辑权限的细粒度判定见 RepoEditPermission）。 */
  const isMainRepo = $derived(
    owner.toLowerCase() === OWNER.toLowerCase() && repo.toLowerCase() === REPO.toLowerCase(),
  )

  // ---- Tab 路由化（URL query 参数驱动，已通过 search schema parse）----
  const navState = $derived(navStore.current)
  /** 当前 Tab（已 parse，默认 files 由 schema 保证）。 */
  const activeTab = $derived(search?.tab ?? 'files')
  /** 各选中项从已 parse 的 search 读取（刷新/前进后退保持）。 */
  const selectedFile = $derived(search?.file ?? '')
  const selectedCommitSha = $derived(search?.sha)
  const selectedIssue = $derived(search?.issue ?? null)
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

  // ---- 仓库元数据（silent：辅助数据，失败不清空统计栏）----
  const repoInfoResource = createResource(
    () => getRepo(owner, repo),
    { silent: true, errorMessage: '加载仓库信息失败' },
  )
  /** repoInfo 便捷别名。 */
  const repoInfo = $derived(repoInfoResource.data)

  // ---- 文件树 + 内容 ----
  let tree = $state<Map<string, TreeNode>>(new Map())
  let expanded = $state<Set<string>>(new Set(['']))
  let loadingDirs = $state<Set<string>>(new Set())
  /** 移动端文件树浮层开关（桌面端用双栏 grid，不用此浮层）。 */
  let fileTreeSheetOpen = $state(false)

  // ---- 历史（commit 列表，列表空态判定）----
  /** commit 过滤器（内存 state，不进 URL；branch 用 RepoRefSelector 切换）。
   *  - commitBranch: branch/tag 名（空=默认分支）
   *  - commitAuthor: GitHub login
   *  - commitSince/commitUntil: ISO 日期（YYYY-MM-DD） */
  let commitBranch = $state<string>('')
  let commitAuthor = $state<string>('')
  let commitSince = $state<string>('')
  let commitUntil = $state<string>('')
  /** 高级过滤器是否激活（branch 不算，因为 branch 有独立的 selector）。 */
  const hasCommitFilters = $derived(!!commitAuthor || !!commitSince || !!commitUntil)
  /** 移动端 commit 列表浮层。 */
  let commitListSheetOpen = $state(false)

  const commitsResource = createResource(
    () => listCommits({
      owner,
      repo,
      perPage: 30,
      sha: commitBranch || undefined,
      author: commitAuthor || undefined,
      // GitHub since/until 接受 ISO 8601；input[type=date] 返回 YYYY-MM-DD，补全为当天起止
      since: commitSince ? `${commitSince}T00:00:00Z` : undefined,
      until: commitUntil ? `${commitUntil}T23:59:59Z` : undefined,
    }),
    { errorMessage: '加载历史失败', isEmpty: (a) => a.length === 0 },
  )
  /** commits 便捷别名（派生，模板用）。 */
  const commits = $derived(commitsResource.data ?? [])

  // ---- 仓库快速搜索（元数据栏，内置 seq 竞态防护）----
  let repoSearchInput = $state('')
  const repoSearchResource = createResource(
    async () => {
      const { searchRepos } = await import('$lib/apps/installable/github/repo-api')
      const { items } = await searchRepos(repoSearchInput.trim(), { perPage: 10 })
      return items
    },
    { errorMessage: '搜索仓库失败', isEmpty: (a) => a.length === 0 },
  )
  /** 搜索结果（null 表示未搜索，[] 表示搜索了但空）。 */
  const repoSearchResults = $derived(
    repoSearchResource.status === 'idle' ? null : (repoSearchResource.data ?? []),
  )

  /** 仓库快速搜索：支持 owner/repo 直跳 或 关键词搜索。 */
  async function handleRepoSearch() {
    const q = repoSearchInput.trim()
    if (!q) {
      repoSearchResource.reset()
      return
    }
    // owner/repo 格式直接跳转
    const directMatch = q.match(/^([\w.-]+)\/([\w.-]+)$/)
    if (directMatch) {
      navController.navigateMain(`/app/github/repo/${directMatch[1]}/${directMatch[2]}`)
      repoSearchInput = ''
      repoSearchResource.reset()
      return
    }
    // 关键词搜索仓库（createResource 内置 seq 竞态防护，替代手写 try/catch）
    void repoSearchResource.run()
  }

  // ---- Issues ----
  /** 三种列表模式：open（默认）/ closed / search（关键词搜索结果）。 */
  type IssueListMode = 'open' | 'closed' | 'search'
  /** 当前列表模式（控制 tab 高亮 + 数据源）。 */
  let issueMode = $state<IssueListMode>('open')
  let issueSearchInput = $state('')
  /** 移动端 issue 列表浮层开关。 */
  let issueListSheetOpen = $state(false)

  const issuesResource = createResource<IssueSummary[]>(
    // 统一处理三种 mode：open/closed 走 listIssues，search 走 searchIssues。
    // 切换 mode 时由 setIssueMode/handleIssueSearch 先 reset 清空旧数据，
    // 让 status 回 loading（骨架），避免 refreshing 保留上一模式的列表。
    async () => {
      if (issueMode === 'search') {
        const q = issueSearchInput.trim()
        if (!q) return []
        const { items } = await searchIssues(owner, repo, q, { perPage: 30 })
        return items
      }
      const state = issueMode === 'closed' ? 'closed' : 'open'
      return listIssues(owner, repo, { state, perPage: 30 })
    },
    { errorMessage: '加载 Issues 失败', isEmpty: (a) => a.length === 0 },
  )
  /** issues 便捷别名。 */
  const issues = $derived(issuesResource.data ?? [])

  /** open/closed 计数（包成单一资源，替代 openCount/closedCount/countsLoading 三态）。 */
  interface IssueCounts { open: number; closed: number }
  const issueCountsResource = createResource<IssueCounts>(
    async () => {
      const [open, closed] = await Promise.all([
        searchIssues(owner, repo, 'is:open', { perPage: 1 }),
        searchIssues(owner, repo, 'is:closed', { perPage: 1 }),
      ])
      return { open: open.total, closed: closed.total }
    },
    { silent: true, errorMessage: '加载计数失败' },
  )
  /** open 计数（null 表示未加载）。 */
  const openCount = $derived(issueCountsResource.data?.open ?? null)
  /** closed 计数（null 表示未加载）。 */
  const closedCount = $derived(issueCountsResource.data?.closed ?? null)

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

  /** owner/repo 变化时重新加载所有数据。
   *  各 resource 的 fetcher 闭包读取响应式 owner/repo，run 时取最新值。
   *  o/r 参数仅用于 isMainRepo 判断和 README/文件树等手写加载。
   *  reset 清空所有旧数据：切换仓库时标题/统计/列表完全不同，走骨架而非 refreshing。
   *  同时重置 issue 模式/搜索词：避免新仓库沿用上一个仓库的 search 状态。 */
  async function loadAll(o: string, r: string) {
    // 重置所有 mode/过滤器状态：切换仓库时不沿用上一个仓库的过滤条件
    issueMode = 'open'
    issueSearchInput = ''
    commitBranch = ''
    commitAuthor = ''
    commitSince = ''
    commitUntil = ''
    repoInfoResource.reset()
    commitsResource.reset()
    issuesResource.reset()
    issueCountsResource.reset()
    void repoInfoResource.run()
    void autoSelectReadme(o, r)
    void commitsResource.run()
    void loadDir('', o, r)
    void issuesResource.run()
    void issueCountsResource.run()
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
  // commits 数据由 commitsResource 管理（fetcher 闘包读 commitBranch/commitAuthor 等过滤器）
  /** 切换 commit 列表的 branch/tag（RepoRefSelector 回调）。
   *  reset 清空旧列表：不同 branch 的 commit 完全不同，走骨架而非 refreshing。 */
  function setCommitBranch(ref: string) {
    // 选默认分支时清空（让 selector 显示 default，而不是重复存 branch 名）
    commitBranch = ref === (repoInfo?.default_branch ?? 'main') ? '' : ref
    // 切换 branch 时清除选中 commit（不同 branch 的 SHA 不通用）
    if (selectedCommitSha) {
      const sp = new URLSearchParams({ tab: 'history' })
      navController.navigateMain(`${basePath}?${sp.toString()}`, 'REPLACE')
    }
    commitsResource.reset()
    void commitsResource.run()
  }

  /** SHA 直跳：直接跳到 CommitDetail（不走列表过滤）。 */
  function jumpToCommitSha(sha: string) {
    navigateSelect('history', 'sha', sha)
  }

  /** 清除高级过滤器（author/since/until），保留 branch。
   *  reset 清空旧列表：过滤条件变化导致结果集不同，走骨架。 */
  function clearCommitFilters() {
    commitAuthor = ''
    commitSince = ''
    commitUntil = ''
    commitsResource.reset()
    void commitsResource.run()
  }

  /** 应用高级过滤器（author/since/until/branch 变化后触发）。
   *  reset 清空旧列表：过滤条件变化导致结果集不同，走骨架而非 refreshing。 */
  function applyCommitFilters() {
    commitsResource.reset()
    void commitsResource.run()
  }

  // ---- Issues ----
  // issues 数据由 issuesResource 统一管理（open/closed/search 三种 mode 都走 fetcher）。
  // 切换 mode 时 reset 清空旧数据 → run 触发 loading（骨架），避免 refreshing 保留上一模式列表。
  // issueCounts 由 issueCountsResource 管理（silent）。
  /** 切换列表模式（open/closed/search）。
   *  reset 清空旧数据：不同 mode 的列表语义不同，切换时应走骨架而非 refreshing。 */
  function setIssueMode(mode: IssueListMode) {
    issueMode = mode
    issuesResource.reset()
    void issuesResource.run()
  }

  /** 清除搜索，回到之前的 tab（open 或 closed）。 */
  function clearIssueSearch() {
    issueSearchInput = ''
    issueMode = issueMode === 'search' ? 'open' : issueMode
    issuesResource.reset()
    void issuesResource.run()
  }

  /** 搜索 Issues：切换到 search mode 并加载（fetcher 内根据 issueMode==='search' 走 searchIssues）。
   *  reset 清空旧列表 → loading 骨架，提供明确的搜索反馈。 */
  function handleIssueSearch() {
    const q = issueSearchInput.trim()
    if (!q) {
      clearIssueSearch()
      return
    }
    issueMode = 'search'
    issuesResource.reset()
    void issuesResource.run()
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
    <!-- 在 GithubEditor 中打开此仓库（跳编辑器工作区） -->
    <Button
      size="icon-sm"
      variant="ghost"
      onclick={() => navController.navigateMain(`/app/github-editor/repo/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`)}
      aria-label="在编辑器中打开"
      title="在 Github 编辑器中打开"
    >
      <SquarePenIcon class="size-4" />
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
                  repoSearchResource.reset()
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
  {#if repoInfoResource.isLoading}
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
      <Tabs.List class="repo-tabs grid w-full grid-cols-4">
        <Tabs.Trigger value="files" class="gap-1.5"><FolderIcon class="size-4" /><span class="tab-label">文件</span></Tabs.Trigger>
        <Tabs.Trigger value="history" class="gap-1.5"><HistoryIcon class="size-4" /><span class="tab-label">历史</span></Tabs.Trigger>
        <Tabs.Trigger value="issues" class="gap-1.5"><BugIcon class="size-4" /><span class="tab-label">Issues</span></Tabs.Trigger>
        <Tabs.Trigger value="log" class="gap-1.5"><ScrollTextIcon class="size-4" /><span class="tab-label">日志</span></Tabs.Trigger>
      </Tabs.List>

      <!-- 文件 + README -->
      <Tabs.Content value="files" class="p-4">
        <!-- 桌面端（md+）：双栏 grid（不固定高度，内容自然撑开）。
             fileTree 左栏 sticky + 独立滚动，fileContent 右栏直接展开（由 app 内容区滚动）。
             移动端（<md）：fileTree 收进 Sheet 浮动浮层。 -->
        <div class="grid min-w-0 gap-4 md:grid-cols-[minmax(200px,280px)_1fr]">
          <!-- 文件树：桌面端 sticky 左栏（含 ref 选择器工具栏 + 独立滚动），移动端隐藏（用 Sheet 触发）。
               与 history tab 左栏结构一致：工具栏（ref selector）+ 列表区（文件树）。 -->
          <div class="border-border flex max-h-[calc(100dvh-12rem)] min-w-0 flex-col overflow-hidden rounded border md:sticky md:top-2 md:block max-md:hidden">
            <!-- ref 选择器工具栏（与 history tab 一致：常驻在左栏顶部） -->
            <div class="border-border bg-muted/30 flex items-center gap-1.5 border-b px-2 py-1.5">
              <RepoRefSelector
                {owner}
                {repo}
                currentRef={fileRef ?? ''}
                defaultBranch={repoInfo?.default_branch ?? 'main'}
                onSelect={(ref) => {
                  if (ref === (repoInfo?.default_branch ?? 'main')) {
                    clearFileRef()
                  } else {
                    const sp = new URLSearchParams({ tab: 'files' })
                    if (selectedFile) sp.set('file', selectedFile)
                    sp.set('ref', ref)
                    navController.navigateMain(`${basePath}?${sp.toString()}`)
                  }
                }}
              />
              {#if fileRef && fileRef !== (repoInfo?.default_branch ?? 'main')}
                <span class="bg-primary/10 text-primary inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium">
                  <GitCommitHorizontalIcon class="size-3" />
                  历史
                </span>
              {/if}
            </div>
            <!-- 文件树（可滚动区） -->
            <div class="min-h-0 flex-1 overflow-auto p-2 text-sm">
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
          </div>
          <!-- 文件内容（右）：直接展开内容，由 app 内容区滚动 -->
          {#if selectedFile}
            <RepoFileContent
              path={selectedFile}
              {owner}
              {repo}
              branch={repoInfo?.default_branch ?? 'main'}
              commitSha={fileRef ?? ''}
              permissions={repoInfo?.permissions}
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
          <Sheet.Content side="bottom" class="flex max-h-[75dvh] flex-col rounded-t-lg p-0 md:hidden" showCloseButton={false}>
            <Sheet.Header class="flex-row items-center justify-between border-b px-4 py-3">
              <Sheet.Title class="flex items-center gap-2 text-sm font-medium">
                <FolderTreeIcon class="size-4" />
                文件列表
              </Sheet.Title>
              <Sheet.Description class="sr-only">浏览仓库文件树，选择文件查看内容</Sheet.Description>
            </Sheet.Header>
            <!-- ref 选择器工具栏（与桌面端左栏一致） -->
            <div class="border-border bg-muted/30 flex items-center gap-1.5 border-b px-2 py-1.5">
              <RepoRefSelector
                {owner}
                {repo}
                currentRef={fileRef ?? ''}
                defaultBranch={repoInfo?.default_branch ?? 'main'}
                onSelect={(ref) => {
                  if (ref === (repoInfo?.default_branch ?? 'main')) {
                    clearFileRef()
                  } else {
                    const sp = new URLSearchParams({ tab: 'files' })
                    if (selectedFile) sp.set('file', selectedFile)
                    sp.set('ref', ref)
                    navController.navigateMain(`${basePath}?${sp.toString()}`)
                  }
                }}
              />
              {#if fileRef && fileRef !== (repoInfo?.default_branch ?? 'main')}
                <span class="bg-primary/10 text-primary inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium">
                  <GitCommitHorizontalIcon class="size-3" />
                  历史
                </span>
              {/if}
            </div>
            <div class="min-h-0 flex-1 overflow-auto overscroll-contain p-2 text-sm">
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
            {#if commitsResource.status === 'loading'}
              <div class="space-y-2 p-2">
                {#each Array(5) as _}<Skeleton class="h-14 w-full" />{/each}
              </div>
            {:else if commitsResource.status === 'error'}
              <p class="text-destructive px-3 py-4 text-sm">{commitsResource.error}</p>
            {:else if commitsResource.status === 'empty'}
              <p class="text-muted-foreground py-8 text-center text-sm">暂无提交</p>
            {:else}
              <!-- GitHub 风格 commit 列表：avatar + 标题 + body 摘要 + author · 相对时间 + 右侧 SHA -->
              <div class="divide-border divide-y">
                {#each commits as c (c.sha)}
                  <button
                    class="hover:bg-accent/50 flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors {selectedCommitSha === c.sha ? 'bg-accent/70' : ''}"
                    onclick={() => { navigateSelect('history', 'sha', c.sha); commitListSheetOpen = false }}
                  >
                    <!-- avatar（无 avatar 用 initials 占位） -->
                    {#if c.avatarUrl}
                      <img src={c.avatarUrl} alt={c.login ?? ''} class="mt-0.5 size-6 shrink-0 rounded-full" loading="lazy" />
                    {:else}
                      <div class="bg-muted text-muted-foreground mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-medium">
                        {(c.login ?? c.author?.name ?? '?').slice(0, 2).toUpperCase()}
                      </div>
                    {/if}
                    <!-- 主信息区 -->
                    <div class="min-w-0 flex-1">
                      <p class="truncate text-xs font-medium">{c.message}</p>
                      {#if c.body}
                        <p class="text-muted-foreground truncate text-[11px]">{c.body.split('\n').find((l) => l.trim()) ?? ''}</p>
                      {/if}
                      <p class="text-muted-foreground mt-0.5 text-[11px]">
                        <span class="font-medium text-foreground">{c.login ?? c.author?.name ?? 'unknown'}</span>
                        {#if c.author?.date} · {formatTimeAgo(c.author.date)}{/if}
                      </p>
                    </div>
                    <!-- 右侧 SHA 短码 -->
                    <code class="text-muted-foreground mt-0.5 shrink-0 font-mono text-[11px]">{c.sha.slice(0, 7)}</code>
                  </button>
                {/each}
              </div>
            {/if}
          {/snippet}
          <!-- commit 列表左栏 -->
          <div class="max-md:hidden">
            <div class="border-border flex max-h-[calc(100dvh-12rem)] min-w-0 flex-col overflow-hidden rounded border md:sticky md:top-2">
              <!-- 工具栏：RepoRefSelector（branch/tag 切换）+ 过滤按钮 + 刷新 -->
              <div class="border-border bg-muted/30 sticky top-0 z-[1] flex items-center gap-1.5 border-b px-2 py-1.5">
                <RepoRefSelector
                  {owner}
                  {repo}
                  currentRef={commitBranch}
                  defaultBranch={repoInfo?.default_branch ?? 'main'}
                  onSelect={(ref) => /^[0-9a-f]{7,40}$/i.test(ref) ? jumpToCommitSha(ref) : setCommitBranch(ref)}
                />
                <!-- 高级过滤器按钮（author/since/until），带激活计数 badge -->
                <Popover.Root>
                  <Popover.Trigger
                    class="border-border bg-background hover:bg-accent relative inline-flex size-7 items-center justify-center rounded-md border transition-colors"
                    aria-label="高级过滤"
                    title="高级过滤（作者 / 时间范围）"
                  >
                    <FilterIcon class="size-3.5 {hasCommitFilters ? 'text-primary' : 'text-muted-foreground'}" />
                    {#if hasCommitFilters}
                      <span class="bg-primary text-primary-foreground absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 text-[9px] font-medium">
                        {[!!commitAuthor, !!commitSince, !!commitUntil].filter(Boolean).length}
                      </span>
                    {/if}
                  </Popover.Trigger>
                  <Popover.Content class="w-64 p-3" align="start">
                    <div class="space-y-3">
                      <div>
                        <label for="commit-filter-author" class="text-muted-foreground mb-1 block text-[11px] font-medium">作者（GitHub login）</label>
                        <Input id="commit-filter-author" bind:value={commitAuthor} placeholder="如 gaubee" class="h-8 text-xs" />
                      </div>
                      <div class="grid grid-cols-2 gap-2">
                        <div>
                          <label for="commit-filter-since" class="text-muted-foreground mb-1 block text-[11px] font-medium">起始</label>
                          <Input id="commit-filter-since" type="date" bind:value={commitSince} class="h-8 text-xs" />
                        </div>
                        <div>
                          <label for="commit-filter-until" class="text-muted-foreground mb-1 block text-[11px] font-medium">截止</label>
                          <Input id="commit-filter-until" type="date" bind:value={commitUntil} class="h-8 text-xs" />
                        </div>
                      </div>
                      <div class="flex items-center gap-2">
                        <Button size="sm" class="h-7 flex-1 text-xs" onclick={applyCommitFilters}>应用</Button>
                        {#if hasCommitFilters}
                          <Button size="sm" variant="ghost" class="h-7 text-xs" onclick={clearCommitFilters}>清除</Button>
                        {/if}
                      </div>
                    </div>
                  </Popover.Content>
                </Popover.Root>
                <!-- 刷新 -->
                <Button variant="ghost" size="icon-sm" class="ml-auto" onclick={() => commitsResource.run()} disabled={commitsResource.isLoading} aria-label="刷新">
                  <RefreshCwIcon class="size-3 {commitsResource.isLoading ? 'animate-spin' : ''}" />
                </Button>
              </div>
              <!-- 过滤摘要条（激活时显示） -->
              {#if hasCommitFilters}
                <div class="bg-primary/5 border-primary/20 flex flex-wrap items-center gap-1.5 border-b px-2 py-1 text-[11px]">
                  {#if commitAuthor}<span class="text-primary">author: {commitAuthor}</span>{/if}
                  {#if commitSince}<span class="text-primary">since: {commitSince}</span>{/if}
                  {#if commitUntil}<span class="text-primary">until: {commitUntil}</span>{/if}
                  <button type="button" onclick={clearCommitFilters} class="text-muted-foreground hover:text-foreground ml-auto underline">清除</button>
                </div>
              {/if}
              <!-- commit 列表（可滚动） -->
              <div class="min-h-0 flex-1 overflow-auto">
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
            <Sheet.Content side="bottom" class="flex max-h-[75dvh] flex-col rounded-t-lg p-0 md:hidden" showCloseButton={false}>
              <Sheet.Header class="flex-row items-center justify-between border-b px-4 py-3">
                <Sheet.Title class="flex items-center gap-2 text-sm font-medium">
                  <HistoryIcon class="size-4" />
                  提交历史
                </Sheet.Title>
                <Sheet.Description class="sr-only">浏览提交列表</Sheet.Description>
              </Sheet.Header>
              <!-- 移动端也加 branch selector + 过滤 -->
              <div class="border-border flex items-center gap-1.5 border-b px-2 py-1.5">
                <RepoRefSelector
                  {owner}
                  {repo}
                  currentRef={commitBranch}
                  defaultBranch={repoInfo?.default_branch ?? 'main'}
                  onSelect={(ref) => /^[0-9a-f]{7,40}$/i.test(ref) ? jumpToCommitSha(ref) : setCommitBranch(ref)}
                />
                <Popover.Root>
                  <Popover.Trigger
                    class="border-border bg-background hover:bg-accent relative inline-flex size-7 items-center justify-center rounded-md border transition-colors"
                    aria-label="高级过滤"
                  >
                    <FilterIcon class="size-3.5 {hasCommitFilters ? 'text-primary' : 'text-muted-foreground'}" />
                    {#if hasCommitFilters}
                      <span class="bg-primary text-primary-foreground absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 text-[9px] font-medium">
                        {[!!commitAuthor, !!commitSince, !!commitUntil].filter(Boolean).length}
                      </span>
                    {/if}
                  </Popover.Trigger>
                  <Popover.Content class="w-64 p-3" align="start">
                    <div class="space-y-3">
                      <div>
                        <label for="commit-m-filter-author" class="text-muted-foreground mb-1 block text-[11px] font-medium">作者</label>
                        <Input id="commit-m-filter-author" bind:value={commitAuthor} placeholder="GitHub login" class="h-8 text-xs" />
                      </div>
                      <div class="grid grid-cols-2 gap-2">
                        <div>
                          <label for="commit-m-filter-since" class="text-muted-foreground mb-1 block text-[11px] font-medium">起始</label>
                          <Input id="commit-m-filter-since" type="date" bind:value={commitSince} class="h-8 text-xs" />
                        </div>
                        <div>
                          <label for="commit-m-filter-until" class="text-muted-foreground mb-1 block text-[11px] font-medium">截止</label>
                          <Input id="commit-m-filter-until" type="date" bind:value={commitUntil} class="h-8 text-xs" />
                        </div>
                      </div>
                      <div class="flex items-center gap-2">
                        <Button size="sm" class="h-7 flex-1 text-xs" onclick={applyCommitFilters}>应用</Button>
                        {#if hasCommitFilters}
                          <Button size="sm" variant="ghost" class="h-7 text-xs" onclick={clearCommitFilters}>清除</Button>
                        {/if}
                      </div>
                    </div>
                  </Popover.Content>
                </Popover.Root>
              </div>
              <div class="min-h-0 flex-1 overflow-auto overscroll-contain">
                {@render commitList()}
              </div>
            </Sheet.Content>
          </Sheet.Root>
        </div>
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
                  {#if !issuesResource.isLoading}
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
            {#if issuesResource.status === 'loading'}
              <div class="space-y-2 p-2">
                {#each Array(4) as _}<Skeleton class="h-14 w-full" />{/each}
              </div>
            {:else if issuesResource.status === 'error'}
              <p class="text-destructive px-3 py-4 text-sm">{issuesResource.error}</p>
            {:else if issuesResource.status === 'empty'}
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
