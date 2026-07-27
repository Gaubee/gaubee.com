<!--
	IssueContentPanel：Issue 详情面板（右侧）。

	GitHub 官方风格 timeline（2026-07-27 v2）：
	- 标题区：text-xl 大标题 + 醒目状态 Badge（绿 Open / 紫 Closed）+ meta + 彩色 labels
	- Timeline 全局轴线：左侧 2px 竖线穿过所有节点（issue 正文卡片 + 评论卡片 + action 行图标）
	  · 头像用 ring-2 ring-background 遮断轴线 → "坐"在轴线上
	  · event 行用圆形彩色背景小图标（也遮断轴线）
	- 节点类型：
	  · issue 正文 / 评论 → 卡片（border + header bg-muted/50 + body + footer）
	  · event（closed/labeled/…）→ 紧凑 action 行（圆形图标 + actor + action + 时间）
	- 底部：当前用户头像 + CommentEditor（与 timeline 对齐）

	状态机升级（2026-07-28）：issue/comments/events 各自用 createResource 收口。
	events 静默失败（辅助数据）。评论 CRUD / 状态切换用 setData 本地更新。
	切换 issue 时若已有数据，进入 refreshing 保留旧内容（不再清空闪烁）。

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
  import IssueMetaBar from './IssueMetaBar.svelte'
  import CommentEditor from './CommentEditor.svelte'
  import { authStore } from '$lib/auth/session.svelte'
  import { Button } from '$lib/components/ui/button'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import { createResource } from '$lib/apps/installable/github/state'
  import { labelStyleString } from '$lib/utils/label-color'
  import CircleDotIcon from '@lucide/svelte/icons/circle-dot'
  import CheckIcon from '@lucide/svelte/icons/check'
  import BugIcon from '@lucide/svelte/icons/bug'
  import ExternalLinkIcon from '@lucide/svelte/icons/external-link'
  import TagIcon from '@lucide/svelte/icons/tag'
  import UserPlusIcon from '@lucide/svelte/icons/user-plus'
  import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw'
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw'
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
  const currentUserAvatar = $derived(authStore.state.user?.avatar_url ?? null)

  // 三个独立资源：issue 详情（单值）/ 评论列表 / timeline 事件（silent 辅助数据）
  const issueResource = createResource(
    () => getIssue(owner, repo, issueNumber),
    { errorMessage: '加载 issue 失败' },
  )
  const commentsResource = createResource(
    () => listIssueComments(owner, repo, issueNumber),
    { errorMessage: '加载评论失败', isEmpty: (c) => c.length === 0 },
  )
  const eventsResource = createResource(
    () => listIssueEvents(owner, repo, issueNumber),
    { silent: true, errorMessage: '加载事件失败', isEmpty: (e) => e.length === 0 },
  )

  /** issue 详情（便捷别名，模板用）。 */
  const issue = $derived(issueResource.data)
  /** comments 列表（未加载时为空数组）。 */
  const comments = $derived(commentsResource.data ?? [])
  /** events 列表（未加载或 silent 失败时为空数组）。 */
  const events = $derived(eventsResource.data ?? [])

  /** 合并后的 timeline 项（评论 + 事件按时间排序），用于渲染。
   *  discriminated union：kind=issue/comment 是卡片，kind=event 是紧凑行。 */
  type TimelineItem =
    | { kind: 'issue'; timestamp: string }
    | { kind: 'comment'; timestamp: string; comment: IssueComment }
    | { kind: 'event'; timestamp: string; event: IssueEvent }
  const timeline = $derived<TimelineItem[]>(
    [
      // issue 正文作为第一条 timeline（仅在有 issue 时插入）
      issue ? [{ kind: 'issue' as const, timestamp: issue.created_at }] : [],
      ...comments.map((c) => ({ kind: 'comment' as const, timestamp: c.created_at, comment: c })),
      ...events.map((e) => ({ kind: 'event' as const, timestamp: e.created_at, event: e })),
    ]
      .flat()
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()),
  )

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

  // issueNumber 变化时重新加载三个资源（fetcher 闭包读响应式 owner/repo/issueNumber，run 时取最新值）
  // reset 清空旧数据：切换 issue 时标题/状态/作者/timeline 完全不同，保留旧内容会显示错误信息，走骨架。
  $effect(() => {
    const n = issueNumber
    if (!n) return
    issueResource.reset()
    commentsResource.reset()
    eventsResource.reset()
    void issueResource.run()
    void commentsResource.run()
    void eventsResource.run()
  })

  /** 处理评论编辑：调用 API 更新，本地替换评论对象（setData 保持 resource 单源） */
  async function handleEditComment(commentId: number, newBody: string) {
    const { updateIssueComment } = await import('$lib/apps/installable/github/issue-api')
    const updated = await updateIssueComment(owner, repo, commentId, newBody)
    commentsResource.setData((prev) => (prev ?? []).map((c) => (c.id === commentId ? updated : c)))
  }

  /** 处理评论删除：调用 API 删除，本地移除 */
  async function handleDeleteComment(commentId: number) {
    const { deleteIssueComment } = await import('$lib/apps/installable/github/issue-api')
    await deleteIssueComment(owner, repo, commentId)
    commentsResource.setData((prev) => (prev ?? []).filter((c) => c.id !== commentId))
  }

  /** 处理新评论提交：调用 API 创建，追加到列表 */
  async function handleCreateComment(body: string) {
    const created = await createIssueComment(owner, repo, issueNumber, body)
    commentsResource.setData((prev) => [...(prev ?? []), created])
  }

  /** 切换 issue 状态（Close/Reopen） */
  async function handleToggleIssue() {
    if (!issue) return
    const newState = issue.state === 'open' ? 'closed' : 'open'
    const updated = await updateIssue(owner, repo, issueNumber, {
      state: newState,
      state_reason: newState === 'closed' ? 'completed' : 'reopened',
    })
    issueResource.setData(updated)
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
    /** 圆形图标背景色（GitHub 风格：closed=紫，reopened=绿，labeled=灰） */
    iconBgClass: string
    iconColorClass: string
    /** 文案（不含作者名和时间，由模板拼接）。 */
    text: string
    /** 可选的彩色 chip（如 label 名）的 style 字符串。 */
    chipStyle?: string
    chipText?: string
  } | null {
    switch (e.event) {
      case 'closed':
        return {
          icon: CheckIcon,
          iconBgClass: 'bg-purple-500/15',
          iconColorClass: 'text-purple-500',
          text: '关闭了此 issue',
        }
      case 'reopened':
        return {
          icon: RotateCcwIcon,
          iconBgClass: 'bg-emerald-500/15',
          iconColorClass: 'text-emerald-500',
          text: '重新打开了此 issue',
        }
      case 'labeled':
        return {
          icon: TagIcon,
          iconBgClass: 'bg-muted',
          iconColorClass: 'text-muted-foreground',
          text: '添加了标签',
          chipStyle: e.label ? labelStyleString(e.label.color) : undefined,
          chipText: e.label?.name,
        }
      case 'unlabeled':
        return {
          icon: TagIcon,
          iconBgClass: 'bg-muted',
          iconColorClass: 'text-muted-foreground',
          text: `移除了标签 ${e.label?.name ?? ''}`,
        }
      case 'assigned':
        return {
          icon: UserPlusIcon,
          iconBgClass: 'bg-muted',
          iconColorClass: 'text-muted-foreground',
          text: `指派给 ${e.assignee?.login ?? ''}`,
        }
      case 'unassigned':
        return {
          icon: UserPlusIcon,
          iconBgClass: 'bg-muted',
          iconColorClass: 'text-muted-foreground',
          text: `取消指派 ${e.assignee?.login ?? ''}`,
        }
      case 'referenced':
        return {
          icon: GitCommitHorizontalIcon,
          iconBgClass: 'bg-muted',
          iconColorClass: 'text-muted-foreground',
          text: '在提交中引用了此 issue',
        }
      case 'renamed':
        return {
          icon: PencilLineIcon,
          iconBgClass: 'bg-muted',
          iconColorClass: 'text-muted-foreground',
          text: `修改了标题`,
        }
      case 'milestoned':
        return {
          icon: MilestoneIcon,
          iconBgClass: 'bg-muted',
          iconColorClass: 'text-muted-foreground',
          text: `添加到里程碑 ${e.milestone?.title ?? ''}`,
        }
      case 'demilestoned':
        return {
          icon: MilestoneIcon,
          iconBgClass: 'bg-muted',
          iconColorClass: 'text-muted-foreground',
          text: `从里程碑 ${e.milestone?.title ?? ''} 移除`,
        }
      default:
        return null
    }
  }
</script>

<div class="flex h-full flex-col overflow-hidden">
  <!-- 可滚动区：title + timeline（issue 正文 + events + comments 统一渲染）。 -->
  <div class="min-h-0 flex-1 overflow-auto px-4 py-4">
    {#if issueResource.status === 'loading'}
      <Skeleton class="mb-2 h-7 w-3/4" />
      <Skeleton class="mb-4 h-3 w-1/2" />
      <div class="mb-6 space-y-4">
        <div class="flex gap-3">
          <Skeleton class="size-7 shrink-0 rounded-full" />
          <div class="flex-1">
            <Skeleton class="mb-2 h-8 w-full" />
            <Skeleton class="mb-2 h-3 w-full" />
            <Skeleton class="h-20 w-full" />
          </div>
        </div>
      </div>
    {:else if issueResource.status === 'error'}
      <p class="text-destructive text-sm">{issueResource.error}</p>
    {:else if issue}
      <!-- 标题区：大标题 + 状态 Badge + meta + labels -->
      <div class="mb-6">
        <!-- 标题行：移动端列表按钮 + 标题 + 状态 Badge + GitHub 外链 -->
        <div class="mb-2 flex items-start gap-2">
          <Button size="sm" variant="default" class="md:hidden" onclick={onopenissuelist} aria-label="打开 Issue 列表">
            <BugIcon class="size-4" />
          </Button>
          <h2 class="min-w-0 flex-1 break-words text-xl font-semibold leading-tight">
            {issue.title}
            <span class="text-muted-foreground ml-1.5 font-normal">#{issue.number}</span>
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
            class="text-muted-foreground hover:bg-accent hover:text-foreground inline-flex shrink-0 size-6 items-center justify-center rounded transition-colors"
            aria-label="在 GitHub 查看"
            title="在 GitHub 查看"
          >
            <ExternalLinkIcon class="size-3.5" />
          </a>
        </div>

        <!-- 元信息缩略行：点击弹 Dialog 看完整信息（assignees/labels/milestone/participants）。
             取代旧的「作者头像+名字+时间」meta 行（与第一条 timeline 卡片 header 重复）。 -->
        {#if issue.state_reason && issue.state === 'closed'}
          <div class="text-muted-foreground mb-2 px-2 text-xs">
            {issue.state_reason === 'completed' ? '已完成' : issue.state_reason === 'not_planned' ? '未计划' : issue.state_reason === 'duplicate' ? '重复' : issue.state_reason}
          </div>
        {/if}
        <div class="mb-4 -mx-2">
          <IssueMetaBar {issue} {events} />
        </div>
      </div>

      <!-- Timeline 列表（带左侧轴线）：issue 正文卡片 + events + comments 按时间合并。
           refreshing（切换 issue 时）保留旧内容 + 顶部指示条。 -->
      {#if commentsResource.status === 'refreshing'}
        <div class="bg-primary/5 text-muted-foreground mb-3 flex items-center justify-center gap-1.5 rounded px-3 py-1 text-[11px]">
          <RefreshCwIcon class="size-3 animate-spin" />
          <span>同步评论…</span>
        </div>
      {/if}
      {#if commentsResource.status === 'loading'}
        <div class="space-y-4">
          {#each Array(3) as _}
            <div class="flex gap-3">
              <Skeleton class="size-7 shrink-0 rounded-full" />
              <div class="flex-1">
                <Skeleton class="mb-2 h-8 w-full" />
                <Skeleton class="mb-2 h-3 w-full" />
                <Skeleton class="h-16 w-full" />
              </div>
            </div>
          {/each}
        </div>
      {:else if commentsResource.status === 'error'}
        <p class="text-destructive text-sm">{commentsResource.error}</p>
      {:else}
        <!-- timeline 容器：左侧 2px 轴线（absolute）穿过所有节点的头像/图标中心 -->
        <div class="relative">
          <!-- 轴线（位于头像列中心：gap-3 → 头像 28px → 中心 14px） -->
          <div class="border-border absolute top-2 bottom-2 w-px" style="left: 13.5px"></div>
          <div class="space-y-4">
            {#each timeline as item (item.kind === 'issue' ? 'issue' : item.kind === 'comment' ? `c${item.comment.id}` : `e${item.event.id}`)}
              {#if item.kind === 'issue'}
                <!-- issue 正文卡片（与评论卡片同款结构，但 author 就是 issue 作者） -->
                <div class="flex items-start gap-3">
                  <img
                    src={issue.user.avatar_url}
                    alt={issue.user.login}
                    class="size-7 shrink-0 rounded-full ring-2 ring-background"
                    loading="lazy"
                  />
                  <div
                    class="border-border bg-card hover:border-foreground/30 min-w-0 flex-1 overflow-hidden rounded-lg border transition-colors"
                  >
                    <div class="border-border bg-muted/50 flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-2">
                      <span class="text-sm font-semibold text-foreground">{issue.user.login}</span>
                      <span class="text-muted-foreground text-xs">opened {formatTimeAgo(issue.created_at)}</span>
                      <span class="text-muted-foreground ml-auto text-[10px] uppercase tracking-wide">作者</span>
                    </div>
                    <div class="px-3 py-3">
                      {#if issue.body}
                        <MarkdownViewer markdown={issue.body} />
                      {:else}
                        <p class="text-muted-foreground text-sm italic">无描述</p>
                      {/if}
                    </div>
                    {#if activeReactions.length > 0}
                      <div class="border-border flex flex-wrap items-center gap-1.5 border-t px-3 py-2">
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
              {:else if item.kind === 'comment'}
                <!-- 评论卡片（结构与 issue 正文卡片一致，由 IssueCommentItem 渲染） -->
                <div class="flex items-start gap-3">
                  <IssueCommentItem
                    comment={item.comment}
                    {owner}
                    {repo}
                    {currentUser}
                    onedit={handleEditComment}
                    ondelete={handleDeleteComment}
                  />
                </div>
              {:else}
                {@const meta = eventMeta(item.event)}
                {#if meta}
                  <!-- 紧凑 action 行：圆形彩色背景图标（遮断轴线）+ actor + action + 时间 -->
                  <div class="flex items-center gap-3 py-0.5">
                    <div
                      class="bg-background ring-2 ring-background inline-flex size-7 shrink-0 items-center justify-center rounded-full {meta.iconBgClass}"
                    >
                      <meta.icon class="size-3.5 {meta.iconColorClass}" />
                    </div>
                    <div class="text-muted-foreground flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
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
                      <span class="opacity-70">{formatTimeAgo(item.event.created_at)}</span>
                    </div>
                  </div>
                {/if}
              {/if}
            {/each}
            {#if timeline.length === 0}
              <p class="text-muted-foreground py-4 text-center text-sm">暂无评论</p>
            {/if}
          </div>
        </div>
      {/if}
    {/if}
  </div>

  <!-- 底部评论编辑器（与 timeline 风格对齐：左头像 + 右卡片） -->
  <footer class="border-border bg-background border-t px-4 py-3">
    {#if currentUser}
      <div class="flex items-start gap-3">
        <!-- 当前用户头像（与 timeline 头像同尺寸、同 ring 风格） -->
        {#if currentUserAvatar}
          <img
            src={currentUserAvatar}
            alt={currentUser}
            class="size-7 shrink-0 rounded-full ring-2 ring-background"
            loading="lazy"
          />
        {:else}
          <div class="bg-muted size-7 shrink-0 rounded-full ring-2 ring-background"></div>
        {/if}
        <div class="min-w-0 flex-1">
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
        </div>
      </div>
    {:else}
      <p class="text-muted-foreground text-center text-xs">登录后评论</p>
    {/if}
  </footer>
</div>
