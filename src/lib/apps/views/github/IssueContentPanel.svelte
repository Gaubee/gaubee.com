<!--
	IssueContentPanel：Issue 详情面板（右侧）。

	展示 issue 完整信息（标题/状态/作者/标签/reactions/正文）+ 评论列表 + 底部评论编辑器。
	issueNumber 变化时自动重新加载。
-->
<script lang="ts">
  import {
    getIssue,
    listIssueComments,
    createIssueComment,
    type IssueDetail,
    type IssueComment,
    type Reactions,
  } from '$lib/apps/installable/github/issue-api'
  import { updateIssue } from '$lib/apps/installable/github/issue-api'
  import MarkdownViewer from '$lib/markdown/MarkdownViewer.svelte'
  import IssueCommentItem from './IssueCommentItem.svelte'
  import CommentEditor from './CommentEditor.svelte'
  import { authStore } from '$lib/auth/session.svelte'
  import { Button } from '$lib/components/ui/button'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import { Badge } from '$lib/components/ui/badge'
  import BugIcon from '@lucide/svelte/icons/bug'
  import MessageCircleIcon from '@lucide/svelte/icons/message-circle'
  import ExternalLinkIcon from '@lucide/svelte/icons/external-link'

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

  /** 加载 issue 详情 + 评论列表 */
  async function loadAll(o: string, r: string, n: number) {
    await Promise.all([loadIssue(o, r, n), loadComments(o, r, n)])
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

  /** 处理评论编辑：调用 API 更新，本地替换评论对象 */
  async function handleEditComment(commentId: number, newBody: string) {
    // IssueCommentItem 的 onedit 由父级负责实际 API 调用
    // 这里通过动态 import 避免顶部 import 列表过重（保持与 issue-api 一致）
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
</script>

<div class="flex h-full flex-col overflow-hidden">
  <!-- 顶部 issue 元数据栏 -->
  <header class="border-b border-border px-4 py-3">
    {#if issueLoading}
      <Skeleton class="mb-2 h-5 w-2/3" />
      <Skeleton class="h-3 w-1/3" />
    {:else if issueError}
      <p class="text-destructive text-sm">{issueError}</p>
    {:else if issue}
      <!-- 标题 + 状态 -->
      <div class="mb-2 flex items-start gap-2">
        <!-- 移动端：issue 列表触发按钮（桌面端隐藏）-->
        <Button size="sm" variant="default" class="md:hidden" onclick={onopenissuelist} aria-label="打开 Issue 列表">
          <BugIcon class="size-4" />
        </Button>
        <BugIcon class="text-muted-foreground mt-0.5 size-4 shrink-0 max-md:hidden" />
        <h2 class="min-w-0 flex-1 break-words text-sm font-semibold">
          <span class="text-muted-foreground">#{issue.number}</span>
          {issue.title}
        </h2>
        <Badge
          variant={issue.state === 'open' ? 'default' : 'secondary'}
          class="shrink-0 text-[10px]"
        >
          {issue.state === 'open' ? '开启' : '关闭'}
        </Badge>
        <!-- GitHub 外链 -->
        <a
          href={issue.html_url}
          target="_blank"
          rel="noopener noreferrer"
          class="text-muted-foreground hover:text-foreground shrink-0"
          aria-label="在 GitHub 查看"
        >
          <ExternalLinkIcon class="size-3.5" />
        </a>
      </div>

      <!-- 作者 + 时间 + 评论数 + state_reason -->
      <div class="text-muted-foreground mb-2 flex flex-wrap items-center gap-2 text-xs">
        <img
          src={issue.user.avatar_url}
          alt={issue.user.login}
          class="size-4 rounded-full"
          loading="lazy"
        />
        <span class="font-medium text-foreground">{issue.user.login}</span>
        <span>· {new Date(issue.created_at).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })} 创建</span>
        <span>· {new Date(issue.updated_at).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })} 更新</span>
        <span class="inline-flex items-center gap-0.5">
          <MessageCircleIcon class="size-3" />
          {issue.comments} 评论
        </span>
        {#if issue.state_reason && issue.state === 'closed'}
          <span>· {issue.state_reason === 'completed' ? '已完成' : issue.state_reason === 'not_planned' ? '未计划' : issue.state_reason === 'duplicate' ? '重复' : issue.state_reason}</span>
        {/if}
      </div>

      <!-- 标签 -->
      {#if issue.labels.length > 0}
        <div class="mb-2 flex flex-wrap gap-1">
          {#each issue.labels as label}
            <Badge variant="outline" class="text-[10px]">{label.name}</Badge>
          {/each}
        </div>
      {/if}

      <!-- reactions 统计 -->
      {#if activeReactions.length > 0}
        <div class="flex flex-wrap items-center gap-1.5">
          {#each activeReactions as r}
            <span
              class="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
              title={r.key}
            >
              <span>{r.emoji}</span>
              <span>{reactionOf(issue.reactions, r.key)}</span>
            </span>
          {/each}
        </div>
      {/if}
    {:else}
      <p class="text-muted-foreground text-sm">未加载</p>
    {/if}
  </header>

  <!-- 中间：issue 正文 + 评论列表（可滚动） -->
  <div class="min-h-0 flex-1 overflow-auto px-4 py-3">
    <!-- issue 正文 -->
    {#if issueLoading}
      <Skeleton class="mb-2 h-3 w-full" />
      <Skeleton class="mb-2 h-3 w-5/6" />
      <Skeleton class="h-32 w-full" />
    {:else if issue}
      {#if issue.body}
        <MarkdownViewer markdown={issue.body} />
      {:else}
        <p class="text-muted-foreground text-sm italic">无描述</p>
      {/if}
    {/if}

    <!-- 评论列表 -->
    <section class="mt-4">
      <h3 class="text-muted-foreground mb-2 flex items-center gap-1 text-xs font-medium uppercase tracking-wide">
        <MessageCircleIcon class="size-3.5" />
        评论 ({comments.length})
      </h3>

      {#if commentsLoading}
        <div class="space-y-2">
          {#each Array(3) as _}
            <Skeleton class="h-16 w-full" />
          {/each}
        </div>
      {:else if commentsError}
        <p class="text-destructive text-sm">{commentsError}</p>
      {:else if comments.length === 0}
        <p class="text-muted-foreground py-4 text-center text-sm">暂无评论，快来抢沙发~</p>
      {:else}
        <div>
          {#each comments as comment (comment.id)}
            <IssueCommentItem
              {comment}
              {owner}
              {repo}
              {currentUser}
              onedit={handleEditComment}
              ondelete={handleDeleteComment}
            />
          {/each}
        </div>
      {/if}
    </section>
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
