<!--
	IssueCommentItem：单条 issue 评论的渲染组件（Card 样式）。

	结构：
	- Card.Header：作者头像/login/badge/时间/已编辑 + 编辑删除按钮
	- Card.Content：body Markdown 渲染
	- Card.Footer：reactions 展示（emoji 计数）
-->
<script lang="ts">
  import MarkdownViewer from '$lib/markdown/MarkdownViewer.svelte'
  import CommentEditor from './CommentEditor.svelte'
  import { type IssueComment } from '$lib/apps/installable/github/issue-api'
  import { Badge } from '$lib/components/ui/badge'
  import * as Card from '$lib/components/ui/card'
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
  const visibleAssociation = $derived(
    comment.author_association && comment.author_association !== 'NONE'
      ? comment.author_association
      : null,
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
  <Card.Root>
    <!-- Card Header：作者信息 + 操作按钮 -->
    <Card.Header class="flex-row flex-wrap items-center gap-2 space-y-0 py-2.5">
      <img
        src={comment.user.avatar_url}
        alt={comment.user.login}
        class="size-6 rounded-full"
        loading="lazy"
      />
      <span class="text-xs font-medium">{comment.user.login}</span>
      {#if visibleAssociation}
        <Badge variant="secondary" class="text-[10px]">{visibleAssociation}</Badge>
      {/if}
      <span class="text-muted-foreground text-xs">
        {new Date(comment.created_at).toLocaleDateString('zh-CN')}
      </span>
      {#if isEdited}
        <span class="text-muted-foreground text-xs italic">已编辑</span>
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
    </Card.Header>

    <!-- Card Content：body 渲染 -->
    <Card.Content class="px-4 pb-3 pt-0">
      {#if comment.body}
        <MarkdownViewer markdown={comment.body} />
      {:else}
        <p class="text-muted-foreground text-sm italic">无内容</p>
      {/if}
    </Card.Content>

    <!-- Card Footer：reactions -->
    {#if activeReactions.length > 0}
      <Card.Footer class="border-t border-border flex-wrap gap-1.5 px-4 py-2">
        {#each activeReactions as r}
          <span
            class="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
            title={r.key}
          >
            <span>{r.emoji}</span>
            <span>{comment.reactions?.[r.key] ?? 0}</span>
          </span>
        {/each}
      </Card.Footer>
    {/if}
  </Card.Root>
{/if}
