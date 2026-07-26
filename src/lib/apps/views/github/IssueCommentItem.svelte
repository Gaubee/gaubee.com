<!--
	IssueCommentItem：单条 issue 评论的渲染组件。

	功能：
	- 作者信息行（头像/login/author_association badge/创建时间/已编辑提示）
	- body Markdown 渲染
	- reactions 展示（emoji 计数）
	- 编辑模式（内嵌 CommentEditor）/ 删除（确认后调 ondelete）
	- 编辑/删除按钮仅当 comment.user.login === currentUser（或 author_association === 'OWNER'）显示
-->
<script lang="ts">
  import MarkdownViewer from '$lib/markdown/MarkdownViewer.svelte'
  import CommentEditor from './CommentEditor.svelte'
  import { type IssueComment } from '$lib/apps/installable/github/issue-api'
  import { Badge } from '$lib/components/ui/badge'
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

  // 编辑模式状态
  let editingState = $state(false)
  // 删除确认状态
  let confirmingDelete = $state(false)

  // 是否可编辑/删除：评论作者本人或仓库 OWNER
  const canModify = $derived(
    currentUser !== null &&
      (comment.user.login === currentUser || comment.author_association === 'OWNER'),
  )

  // 是否已编辑（updated_at !== created_at）
  const isEdited = $derived(comment.updated_at !== comment.created_at)

  // author_association 是否需要展示 badge（OWNER/MEMBER 显示，NONE 不显示）
  const visibleAssociation = $derived(
    comment.author_association && comment.author_association !== 'NONE'
      ? comment.author_association
      : null,
  )

  // reactions 字段定义（用于约束 emoji 映射的 key 类型）
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
  // reactions emoji 映射（仅展示计数 > 0 的）
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

  // 当前评论的非空 reactions 列表
  const activeReactions = $derived(
    comment.reactions && comment.reactions.total_count > 0
      ? reactionEmojis.filter((r) => (comment.reactions?.[r.key] ?? 0) > 0)
      : [],
  )

  // 进入编辑模式
  function startEdit() {
    editingState = true
    confirmingDelete = false
  }

  // 退出编辑模式
  function cancelEdit() {
    editingState = false
  }

  // 提交编辑：调用 onedit，成功后退出编辑模式
  async function handleSubmit(body: string) {
    await onedit?.(comment.id, body)
    editingState = false
  }

  // 确认删除
  async function handleDelete() {
    await ondelete?.(comment.id)
    confirmingDelete = false
  }
</script>

<article class="border-b border-border py-3 last:border-b-0">
  {#if editingState}
    <!-- 编辑模式：内嵌 CommentEditor -->
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
    <!-- 作者信息行 -->
    <div class="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
      <img
        src={comment.user.avatar_url}
        alt={comment.user.login}
        class="size-6 rounded-full"
        loading="lazy"
      />
      <span class="font-medium">{comment.user.login}</span>
      {#if visibleAssociation}
        <Badge variant="secondary" class="text-[10px]">{visibleAssociation}</Badge>
      {/if}
      <span class="text-muted-foreground">
        评论于 {new Date(comment.created_at).toLocaleDateString('zh-CN')}
      </span>
      {#if isEdited}
        <span class="text-muted-foreground italic">已编辑</span>
      {/if}

      {#if canModify}
        <div class="ml-auto flex items-center gap-1">
          <button
            type="button"
            class="hover:bg-accent text-muted-foreground rounded p-1 transition-colors hover:text-foreground"
            aria-label="编辑评论"
            title="编辑"
            onclick={startEdit}
          >
            <PencilIcon class="size-3.5" />
          </button>
          {#if confirmingDelete}
            <button
              type="button"
              class="bg-destructive text-destructive-foreground rounded px-2 py-0.5 text-[10px] transition-colors"
              onclick={handleDelete}
            >
              确认删除
            </button>
            <button
              type="button"
              class="hover:bg-accent text-muted-foreground rounded px-2 py-0.5 text-[10px]"
              onclick={() => (confirmingDelete = false)}
            >
              取消
            </button>
          {:else}
            <button
              type="button"
              class="hover:bg-accent text-muted-foreground rounded p-1 transition-colors hover:text-destructive"
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

    <!-- body 渲染 -->
    {#if comment.body}
      <MarkdownViewer markdown={comment.body} />
    {:else}
      <p class="text-muted-foreground text-sm italic">无内容</p>
    {/if}

    <!-- reactions 展示 -->
    {#if activeReactions.length > 0}
      <div class="mt-2 flex flex-wrap items-center gap-1.5">
        {#each activeReactions as r}
          <span
            class="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
            title={r.key}
          >
            <span>{r.emoji}</span>
            <span>{comment.reactions?.[r.key] ?? 0}</span>
          </span>
        {/each}
      </div>
    {/if}
  {/if}
</article>
