<!--
	IssueCommentItem：单条 issue 评论的 timeline 渲染（GitHub 风格）。

	2026-07-27 升级：从 Card 样式改为 GitHub timeline 风格。
	结构：
	- 左侧头像（与 issue 正文 timeline 对齐）
	- 右侧卡片：
	  - header: author + role badge（彩色）+ timestamp + 已编辑 + 编辑/删除按钮
	  - body: markdown 渲染
	  - footer: reactions（hover 可点的 pill）
-->
<script lang="ts">
  import MarkdownViewer from '$lib/markdown/MarkdownViewer.svelte'
  import CommentEditor from './CommentEditor.svelte'
  import { type IssueComment } from '$lib/apps/installable/github/issue-api'
  import PencilIcon from '@lucide/svelte/icons/pencil'
  import Trash2Icon from '@lucide/svelte/icons/trash-2'

  let {
    comment,
    owner,
    repo,
    currentUser,
    onedit,
    ondelete,
  }: {
    comment: IssueComment
    owner: string
    repo: string
    currentUser: string | null
    onedit?: (commentId: number, newBody: string) => Promise<void>
    ondelete?: (commentId: number) => Promise<void>
  } = $props()

  let editingState = $state(false)
  let confirmingDelete = $state(false)

  const canModify = $derived(
    currentUser !== null &&
      (comment.user.login === currentUser || comment.author_association === 'OWNER'),
  )
  const isEdited = $derived(comment.updated_at !== comment.created_at)
  /** author_association 归一化：NONE 不显示，其它显示彩色 badge。 */
  const visibleAssociation = $derived(
    comment.author_association && comment.author_association !== 'NONE'
      ? comment.author_association
      : null,
  )

  /** role badge 配色（GitHub 风格：OWNER/MEMBER=绿色，COLLABORATOR=橙色，CONTRIBUTOR=灰色）。 */
  const associationStyle = $derived(
    visibleAssociation
      ? visibleAssociation === 'OWNER' || visibleAssociation === 'MEMBER'
        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
        : visibleAssociation === 'COLLABORATOR'
          ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
          : 'bg-muted text-muted-foreground'
      : '',
  )

  const reactionFields = {
    '+1': 0, '-1': 0, laugh: 0, hooray: 0,
    confused: 0, heart: 0, rocket: 0, eyes: 0,
  }
  const reactionEmojis: Array<{ key: keyof typeof reactionFields; emoji: string }> = [
    { key: '+1', emoji: '👍' }, { key: '-1', emoji: '👎' },
    { key: 'laugh', emoji: '😄' }, { key: 'hooray', emoji: '🎉' },
    { key: 'confused', emoji: '😕' }, { key: 'heart', emoji: '❤️' },
    { key: 'rocket', emoji: '🚀' }, { key: 'eyes', emoji: '👀' },
  ]

  const activeReactions = $derived(
    comment.reactions && comment.reactions.total_count > 0
      ? reactionEmojis.filter((r) => (comment.reactions?.[r.key] ?? 0) > 0)
      : [],
  )

  function startEdit() {
    editingState = true
    confirmingDelete = false
  }

  function cancelEdit() {
    editingState = false
  }

  async function handleSubmit(body: string) {
    await onedit?.(comment.id, body)
    editingState = false
  }

  async function handleDelete() {
    await ondelete?.(comment.id)
    confirmingDelete = false
  }

  /** 相对时间格式化（与父组件一致）。 */
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
</script>

{#if editingState}
  <CommentEditor
    {owner}
    {repo}
    commentId={comment.id}
    initialBody={comment.body ?? ''}
    submitLabel="更新"
    onSubmit={handleSubmit}
    onCancel={cancelEdit}
  />
{:else}
  <!-- GitHub timeline 风格：左头像 + 右卡片，与 issue 正文 timeline 对齐 -->
  <div class="flex gap-3">
    <!-- 左侧头像 -->
    <img
      src={comment.user.avatar_url}
      alt={comment.user.login}
      class="mt-0.5 size-7 shrink-0 rounded-full"
      loading="lazy"
    />
    <!-- 右侧卡片 -->
    <div class="min-w-0 flex-1">
      <!-- 卡片 header: author + role badge + timestamp + 已编辑 + actions -->
      <div class="text-muted-foreground mb-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
        <span class="font-semibold text-foreground">{comment.user.login}</span>
        {#if visibleAssociation}
          <span
            class="inline-flex items-center rounded-full px-1.5 py-0 text-[10px] font-medium leading-[1.4] {associationStyle}"
          >
            {visibleAssociation}
          </span>
        {/if}
        <span>commented {formatTimeAgo(comment.created_at)}</span>
        {#if isEdited}
          <span class="italic opacity-70">· 已编辑</span>
        {/if}

        {#if canModify}
          <div class="ml-auto flex items-center gap-0.5">
            <button
              type="button"
              class="hover:bg-accent text-muted-foreground inline-flex size-6 items-center justify-center rounded transition-colors hover:text-foreground"
              aria-label="编辑评论"
              title="编辑"
              onclick={startEdit}
            >
              <PencilIcon class="size-3.5" />
            </button>
            {#if confirmingDelete}
              <button
                type="button"
                class="bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded px-1.5 py-0.5 text-[10px] transition-colors"
                onclick={handleDelete}
              >
                确认删除
              </button>
              <button
                type="button"
                class="hover:bg-accent text-muted-foreground rounded px-1.5 py-0.5 text-[10px]"
                onclick={() => (confirmingDelete = false)}
              >
                取消
              </button>
            {:else}
              <button
                type="button"
                class="hover:bg-accent text-muted-foreground inline-flex size-6 items-center justify-center rounded transition-colors hover:text-destructive"
                aria-label="删除评论"
                title="删除"
                onclick={() => (confirmingDelete = true)}
              >
                <Trash2Icon class="size-3.5" />
              </button>
            {/if}
          </div>
        {/if}
      </div>

      <!-- 卡片 body: markdown 渲染 -->
      {#if comment.body}
        <MarkdownViewer markdown={comment.body} />
      {:else}
        <p class="text-muted-foreground text-sm italic">无内容</p>
      {/if}

      <!-- 卡片 footer: reactions（pill 风格，hover 高亮） -->
      {#if activeReactions.length > 0}
        <div class="mt-3 flex flex-wrap items-center gap-1.5">
          {#each activeReactions as r}
            <span
              class="bg-muted text-muted-foreground hover:bg-accent inline-flex cursor-default items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors"
              title={r.key}
            >
              <span>{r.emoji}</span>
              <span class="tabular-nums">{comment.reactions?.[r.key] ?? 0}</span>
            </span>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}
