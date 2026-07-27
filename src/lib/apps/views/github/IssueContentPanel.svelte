<!--
	IssueContentPanel：Issue 详情面板（右侧）。

	GitHub 风格 timeline 设计（2026-07-27 升级）：
	- 标题区：大标题 + 醒目状态 Badge（绿色 Open / 紫色 Closed）+ meta + 彩色 labels
	- Timeline 列表：issue 正文（首条）+ 每条评论都是 timeline 节点
	  左侧头像 + 右侧卡片（header: author + role badge + timestamp + actions；body: markdown；footer: reactions）
	- 底部评论编辑器（含 Close/Reopen 按钮）

	issueNumber 变化时自动重新加载。
-->
<script lang="ts">
  import {
    getIssue,
    listIssueComments,
    listIssueEvents,
    createIssueComment,
    type IssueDetail,
    type IssueComment,
    type IssueEvent,
    type Reactions,
  } from '$lib/apps/installable/github/issue-api'
  import { updateIssue } from '$lib/apps/installable/github/issue-api'
  import MarkdownViewer from '$lib/markdown/MarkdownViewer.svelte'
  import IssueCommentItem from './IssueCommentItem.svelte'
  import CommentEditor from './CommentEditor.svelte'
  import { authStore } from '$lib/auth/session.svelte'
  import { Button } from '$lib/components/ui/button'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import { labelStyleString } from '$lib/utils/label-color'
  import CircleDotIcon from '@lucide/svelte/icons/circle-dot'
  import CheckIcon from '@lucide/svelte/icons/check'
  import BugIcon from '@lucide/svelte/icons/bug'
  import MessageCircleIcon from '@lucide/svelte/icons/message-circle'
  import ExternalLinkIcon from '@lucide/svelte/icons/external-link'
  import TagIcon from '@lucide/svelte/icons/tag'
  import UserPlusIcon from '@lucide/svelte/icons/user-plus'
  import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw'
  import GitCommitHorizontalIcon from '@lucide/svelte/icons/git-commit-horizontal'
  import PencilLineIcon from '@lucide/svelte/icons/pencil-line'
  import MilestoneIcon from '@lucide/svelte/icons/milestone'

  let {
    issueNumber,
    owner,
    repo,
    branch = 'main', // 仓库默认分支（暂未用到，预留）
    onopenissuelist = () => {},
  }: {
    issueNumber: number
    owner: string
    repo: string
    branch?: string
    /** 移动端：打开 issue 列表浮层（桌面端不显示触发按钮）。 */
    onopenissuelist?: () => void
  } = $props()

  // 当前登录用户 login（用于判断是否可编辑/删除评论）
  const currentUser = $derived(authStore.state.user?.login ?? null)

  // issue 详情状态
  let issue = $state<IssueDetail | null>(null)
  let issueLoading = $state(false)
  let issueError = $state<string | null>(null)

  // 评论列表状态
  let comments = $state<IssueComment[]>([])
  let commentsLoading = $state(false)
  let commentsError = $state<string | null>(null)

  // timeline 事件状态（closed/reopened/labeled 等紧凑 action 行）
  let events = $state<IssueEvent[]>([])
  let eventsLoading = $state(false)

  /** 合并后的 timeline 项（评论 + 事件按时间排序），用于渲染。
   *  discriminated union：kind=comment 是卡片，kind=event 是紧凑行。 */
  type TimelineItem =
    | { kind: 'comment'; timestamp: string; comment: IssueComment }
    | { kind: 'event'; timestamp: string; event: IssueEvent }
  const timeline = $derived<TimelineItem[]>([
    ...comments.map((c) => ({ kind: 'comment' as const, timestamp: c.created_at, comment: c })),
    ...events.map((e) => ({ kind: 'event' as const, timestamp: e.created_at, event: e })),
  ].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()))

  // reactions emoji 映射（仅展示计数 > 0 的）
  const reactionFields = {
    '+1': 0,
    '-1': 0,
    laugh: 0,
    hooray: 0,
    confused: 0,
    heart: 0,
    rocket: 0,
    eyes: 0,
  }
  const reactionEmojis: Array<{ key: keyof typeof reactionFields; emoji: string }> = [
    { key: '+1', emoji: '👍' },
    { key: '-1', emoji: '👎' },
    { key: 'laugh', emoji: '😄' },
    { key: 'hooray', emoji: '🎉' },
    { key: 'confused', emoji: '😕' },
    { key: 'heart', emoji: '❤️' },
    { key: 'rocket', emoji: '🚀' },
    { key: 'eyes', emoji: '👀' },
  ]

  // issue 的非空 reactions 列表（注意：派生闭包内 issue 可能 null，统一用可选链）
  const activeReactions = $derived(
    issue?.reactions && issue.reactions.total_count > 0
      ? reactionEmojis.filter((r) => (issue?.reactions?.[r.key] ?? 0) > 0)
      : [],
  )

  // issueNumber/owner/repo 变化时重新加载（读取一次，避免 effect 内引用响应式值触发循环）
  $effect(() => {
    const n = issueNumber
    const o = owner
    const r = repo
    if (!n) return
    void loadAll(o, r, n)
  })

  /** 加载 issue 详情 + 评论列表 + 事件列表 */
  async function loadAll(o: string, r: string, n: number) {
    await Promise.all([loadIssue(o, r, n), loadComments(o, r, n), loadEvents(o, r, n)])
  }

  async function loadIssue(o: string, r: string, n: number) {
    issueLoading = true
    issueError = null
    issue = null
    try {
      issue = await getIssue(o, r, n)
    } catch (e) {
      issueError = e instanceof Error ? e.message : '加载 issue 失败'
    } finally {
      issueLoading = false
    }
  }

  async function loadComments(o: string, r: string, n: number) {
    commentsLoading = true
    commentsError = null
    comments = []
    try {
      comments = await listIssueComments(o, r, n)
    } catch (e) {
      commentsError = e instanceof Error ? e.message : '加载评论失败'
    } finally {
      commentsLoading = false
    }
  }

  /** 加载 timeline 事件（closed/reopened/labeled 等紧凑 action 行）。
   *  失败静默（事件是辅助信息，不影响主流程）。 */
  async function loadEvents(o: string, r: string, n: number) {
    eventsLoading = true
    try {
      events = await listIssueEvents(o, r, n)
    } catch {
      events = []
    } finally {
      eventsLoading = false
    }
  }

  /** 处理评论编辑：调用 API 更新，本地替换评论对象 */
  async function handleEditComment(commentId: number, newBody: string) {
    const { updateIssueComment } = await import('$lib/apps/installable/github/issue-api')
    const updated = await updateIssueComment(owner, repo, commentId, newBody)
    comments = comments.map((c) => (c.id === commentId ? updated : c))
  }

  /** 处理评论删除：调用 API 删除，本地移除 */
  async function handleDeleteComment(commentId: number) {
    const { deleteIssueComment } = await import('$lib/apps/installable/github/issue-api')
    await deleteIssueComment(owner, repo, commentId)
    comments = comments.filter((c) => c.id !== commentId)
  }

  /** 处理新评论提交：调用 API 创建，追加到列表 */
  async function handleCreateComment(body: string) {
    const created = await createIssueComment(owner, repo, issueNumber, body)
    comments = [...comments, created]
  }

  /** 切换 issue 状态（Close/Reopen） */
  async function handleToggleIssue() {
    if (!issue) return
    const newState = issue.state === 'open' ? 'closed' : 'open'
    const updated = await updateIssue(owner, repo, issueNumber, {
      state: newState,
      state_reason: newState === 'closed' ? 'completed' : 'reopened',
    })
    issue = updated
  }

  // reactions 类型守卫辅助（仅用于模板类型收窄）
  function reactionOf(r: Reactions | undefined, key: keyof typeof reactionFields): number {
    return r ? (r[key] ?? 0) : 0
  }

  /** 相对时间格式化（与 issue 列表一致）。 */
  function formatTimeAgo(iso: string): string {
    try {
      const diff = Date.now() - new Date(iso).getTime()
      const day = 24 * 60 * 60 * 1000
      if (diff < 60 * 1000) return '刚刚'
      if (diff < 60 * 60 * 1000) return `${Math.floor(diff / (60 * 1000))} 分钟前`
      if (diff < day) return `${Math.floor(diff / (60 * 60 * 1000))} 小时前`
      if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`
      return new Date(iso).toLocaleDateString('zh-CN', { dateStyle: 'short' })
    } catch {
      return iso
    }
  }

  /** 渲染 event 的紧凑单行（GitHub 风格 action 行）。
   *  返回 null 表示该事件类型不支持渲染（被过滤）。 */
  function eventMeta(e: IssueEvent): {
    icon: typeof CheckIcon
    iconClass: string
    /** 文案（不含作者名和时间，由模板拼接）。 */
    text: string
    /** 可选的彩色 chip（如 label 名）的 style 字符串。 */
    chipStyle?: string
    chipText?: string
  } | null {
    switch (e.event) {
      case 'closed':
        return { icon: CheckIcon, iconClass: 'text-purple-500', text: '关闭了此 issue' }
      case 'reopened':
        return { icon: RotateCcwIcon, iconClass: 'text-emerald-500', text: '重新打开了此 issue' }
      case 'labeled':
        return {
          icon: TagIcon,
          iconClass: 'text-muted-foreground',
          text: '添加了标签',
          chipStyle: e.label ? labelStyleString(e.label.color) : undefined,
          chipText: e.label?.name,
        }
      case 'unlabeled':
        return { icon: TagIcon, iconClass: 'text-muted-foreground', text: `移除了标签 ${e.label?.name ?? ''}` }
      case 'assigned':
        return { icon: UserPlusIcon, iconClass: 'text-muted-foreground', text: `指派给 ${e.assignee?.login ?? ''}` }
      case 'unassigned':
        return { icon: UserPlusIcon, iconClass: 'text-muted-foreground', text: `取消指派 ${e.assignee?.login ?? ''}` }
      case 'referenced':
        return { icon: GitCommitHorizontalIcon, iconClass: 'text-muted-foreground', text: '在提交中引用了此 issue' }
      case 'renamed':
        return { icon: PencilLineIcon, iconClass: 'text-muted-foreground', text: `修改了标题` }
      case 'milestoned':
        return { icon: MilestoneIcon, iconClass: 'text-muted-foreground', text: `添加到里程碑 ${e.milestone?.title ?? ''}` }
      case 'demilestoned':
        return { icon: MilestoneIcon, iconClass: 'text-muted-foreground', text: `从里程碑 ${e.milestone?.title ?? ''} 移除` }
      default:
        return null
    }
  }
</script>

<div class="flex h-full flex-col overflow-hidden">
  <!-- 可滚动区：title + timeline（issue 正文 + events + comments 统一渲染）。
       title 与 issue 首条正文在视觉上合并（无 border-b 分隔）。 -->
  <div class="min-h-0 flex-1 overflow-auto px-4 py-4">
    {#if issueLoading}
      <Skeleton class="mb-2 h-6 w-3/4" />
      <Skeleton class="mb-4 h-3 w-1/2" />
      <div class="mb-6">
        <div class="mb-2 flex items-center gap-2">
          <Skeleton class="size-7 rounded-full" />
          <Skeleton class="h-3 w-32" />
        </div>
        <Skeleton class="mb-2 h-3 w-full" />
        <Skeleton class="mb-2 h-3 w-5/6" />
        <Skeleton class="h-20 w-full" />
      </div>
    {:else if issueError}
      <p class="text-destructive text-sm">{issueError}</p>
    {:else if issue}
      <!-- 标题区：大标题 + 状态 Badge + meta + labels（无 border-b，与下方 timeline 合并） -->
      <div class="mb-4">
        <!-- 标题行：移动端列表按钮 + 标题 + 状态 Badge + GitHub 外链 -->
        <div class="mb-2 flex items-start gap-2">
          <Button size="sm" variant="default" class="md:hidden" onclick={onopenissuelist} aria-label="打开 Issue 列表">
            <BugIcon class="size-4" />
          </Button>
          <h2 class="min-w-0 flex-1 break-words text-base font-semibold leading-tight">
            {issue.title}
            <span class="text-muted-foreground ml-1 font-normal">#{issue.number}</span>
          </h2>
          <span
            class="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium {issue.state === 'open'
              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
              : 'bg-purple-500/15 text-purple-700 dark:text-purple-400'}"
          >
            {#if issue.state === 'open'}
              <CircleDotIcon class="size-3.5" />
              Open
            {:else}
              <CheckIcon class="size-3.5" />
              Closed
            {/if}
          </span>
          <a
            href={issue.html_url}
            target="_blank"
            rel="noopener noreferrer"
            class="text-muted-foreground hover:text-foreground hover:bg-accent inline-flex shrink-0 size-6 items-center justify-center rounded transition-colors"
            aria-label="在 GitHub 查看"
            title="在 GitHub 查看"
          >
            <ExternalLinkIcon class="size-3.5" />
          </a>
        </div>

        <!-- meta 行：opened X ago by user · N comments · state_reason -->
        <div class="text-muted-foreground mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <img
            src={issue.user.avatar_url}
            alt={issue.user.login}
            class="size-4 rounded-full"
            loading="lazy"
          />
          <span class="font-medium text-foreground">{issue.user.login}</span>
          <span>opened {formatTimeAgo(issue.created_at)}</span>
          <span class="opacity-50">·</span>
          <span class="inline-flex items-center gap-0.5">
            <MessageCircleIcon class="size-3" />
            {issue.comments}
          </span>
          {#if issue.state_reason && issue.state === 'closed'}
            <span class="opacity-50">·</span>
            <span>{issue.state_reason === 'completed' ? '已完成' : issue.state_reason === 'not_planned' ? '未计划' : issue.state_reason === 'duplicate' ? '重复' : issue.state_reason}</span>
          {/if}
        </div>

        <!-- labels（GitHub 彩色 label） -->
        {#if issue.labels.length > 0}
          <div class="flex flex-wrap gap-1.5">
            {#each issue.labels as label}
              <span
                class="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium"
                style={labelStyleString(label.color)}
              >
                {label.name}
              </span>
            {/each}
          </div>
        {/if}
      </div>

      <!-- 首条 timeline：issue 正文（作者卡片风格，紧接 title，视觉合并） -->
      <div class="border-border mb-4 border-b pb-4">
        <div class="flex gap-3">
          <img
            src={issue.user.avatar_url}
            alt={issue.user.login}
            class="mt-0.5 size-7 shrink-0 rounded-full"
            loading="lazy"
          />
          <div class="min-w-0 flex-1">
            <div class="text-muted-foreground mb-1.5 flex flex-wrap items-center gap-x-1.5 text-xs">
              <span class="font-semibold text-foreground">{issue.user.login}</span>
              <span>opened {formatTimeAgo(issue.created_at)}</span>
            </div>
            {#if issue.body}
              <MarkdownViewer markdown={issue.body} />
            {:else}
              <p class="text-muted-foreground text-sm italic">无描述</p>
            {/if}
            {#if activeReactions.length > 0}
              <div class="mt-3 flex flex-wrap items-center gap-1.5">
                {#each activeReactions as r}
                  <span
                    class="bg-muted text-muted-foreground hover:bg-accent inline-flex cursor-default items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors"
                    title={r.key}
                  >
                    <span>{r.emoji}</span>
                    <span class="tabular-nums">{reactionOf(issue.reactions, r.key)}</span>
                  </span>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      </div>

      <!-- timeline：events（紧凑 action 行）+ comments（卡片）按时间排序 -->
      {#if commentsLoading}
        <div class="space-y-4">
          {#each Array(3) as _}
            <div class="flex gap-3">
              <Skeleton class="size-7 shrink-0 rounded-full" />
              <div class="flex-1">
                <Skeleton class="mb-2 h-3 w-32" />
                <Skeleton class="mb-2 h-3 w-full" />
                <Skeleton class="h-16 w-full" />
              </div>
            </div>
          {/each}
        </div>
      {:else if commentsError}
        <p class="text-destructive text-sm">{commentsError}</p>
      {:else}
        <div class="space-y-4">
          {#each timeline as item (item.kind === 'comment' ? `c${item.comment.id}` : `e${item.event.id}`)}
            {#if item.kind === 'comment'}
              <IssueCommentItem
                comment={item.comment}
                {owner}
                {repo}
                {currentUser}
                onedit={handleEditComment}
                ondelete={handleDeleteComment}
              />
            {:else}
              {@const meta = eventMeta(item.event)}
              {#if meta}
                <!-- 紧凑 action 行（GitHub 风格：小图标 + actor + action + 时间，无卡片 body） -->
                <div class="text-muted-foreground flex items-center gap-2 py-1 text-xs">
                  <meta.icon class="size-3.5 shrink-0 {meta.iconClass}" />
                  <span class="font-medium text-foreground">{item.event.actor.login}</span>
                  <span>{meta.text}</span>
                  {#if meta.chipText && meta.chipStyle}
                    <span
                      class="inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-medium leading-[1.4]"
                      style={meta.chipStyle}
                    >
                      {meta.chipText}
                    </span>
                  {/if}
                  <span class="ml-auto shrink-0 opacity-70">{formatTimeAgo(item.event.created_at)}</span>
                </div>
              {/if}
            {/if}
          {/each}
          {#if timeline.length === 0 && comments.length === 0}
            <p class="text-muted-foreground py-4 text-center text-sm">暂无评论</p>
          {/if}
        </div>
      {/if}
    {/if}
  </div>

  <!-- 底部评论编辑器 -->
  <footer class="border-t border-border px-4 py-3">
    {#if currentUser}
      <CommentEditor
        {owner}
        {repo}
        issueNumber={issueNumber}
        placeholder="写下你的评论…"
        submitLabel="评论"
        onSubmit={handleCreateComment}
        issueState={issue?.state}
        onToggleIssue={handleToggleIssue}
      />
    {:else}
      <p class="text-muted-foreground text-center text-xs">登录后评论</p>
    {/if}
  </footer>
</div>
