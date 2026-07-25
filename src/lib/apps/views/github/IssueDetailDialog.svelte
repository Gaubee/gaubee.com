<!--
	IssueDetailDialog：Issue 详情 Dialog（GithubApp 详情页 Issues Tab 用）。

	拉取 issue 正文（getIssue），markdown 渲染。展示标题/状态/作者/标签。
-->
<script lang="ts">
  import { getIssue, type IssueDetail } from '$lib/apps/installable/github/repo-api'
  import MarkdownViewer from '$lib/markdown/MarkdownViewer.svelte'
  import { Badge } from '$lib/components/ui/badge'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import * as Dialog from '$lib/components/ui/dialog'
  import BugIcon from '@lucide/svelte/icons/bug'
  import XIcon from '@lucide/svelte/icons/x'

  let {
    open = $bindable(false),
    number,
    owner,
    repo,
    onclose,
  }: {
    open?: boolean
    number: number
    owner: string
    repo: string
    onclose?: () => void
  } = $props()

  let issue = $state<IssueDetail | null>(null)
  let loading = $state(false)
  let error = $state<string | null>(null)

  $effect(() => {
    const n = number
    const o = owner
    const r = repo
    if (!open || !n) return
    void loadIssue(o, r, n)
  })

  async function loadIssue(o: string, r: string, n: number) {
    loading = true
    error = null
    issue = null
    try {
      issue = await getIssue(o, r, n)
    } catch (e) {
      error = e instanceof Error ? e.message : '加载失败'
    } finally {
      loading = false
    }
  }

  function handleClose() {
    open = false
    onclose?.()
  }
</script>

<Dialog.Root
  bind:open
  onOpenChange={(v) => {
    if (!v) handleClose()
  }}
>
  <Dialog.Content class="max-h-[85vh] max-w-2xl overflow-hidden p-0" showCloseButton={false}>
    <Dialog.Header class="flex-row items-center gap-2 border-b border-border px-4 py-3">
      <BugIcon class="size-4 shrink-0 text-muted-foreground" />
      <Dialog.Title class="truncate text-sm">
        {#if issue}#{issue.number} {issue.title}{:else}Issue #{number}{/if}
      </Dialog.Title>
      {#if issue}
        <Badge variant={issue.state === 'open' ? 'default' : 'secondary'} class="text-[10px]">
          {issue.state === 'open' ? '开启' : '关闭'}
        </Badge>
      {/if}
      <Dialog.Close class="ml-auto">
        <button class="hover:bg-accent rounded p-1" aria-label="关闭">
          <XIcon class="size-4" />
        </button>
      </Dialog.Close>
    </Dialog.Header>

    <div class="max-h-[70vh] overflow-auto p-4">
      {#if loading}
        <Skeleton class="mb-2 h-4 w-1/3" />
        <Skeleton class="h-40" />
      {:else if error}
        <p class="text-destructive text-sm">{error}</p>
      {:else if issue}
        <div class="text-muted-foreground mb-3 flex items-center gap-2 text-xs">
          <img src={issue.user.avatar_url} alt={issue.user.login} class="size-5 rounded-full" />
          <span>{issue.user.login}</span>
          <span>· {new Date(issue.created_at).toLocaleDateString('zh-CN')}</span>
          {#if issue.comments > 0}<span>· {issue.comments} 评论</span>{/if}
        </div>
        {#if issue.labels.length > 0}
          <div class="mb-3 flex flex-wrap gap-1">
            {#each issue.labels as label}
              <Badge variant="outline" class="text-[10px]">{label.name}</Badge>
            {/each}
          </div>
        {/if}
        {#if issue.body}
          <MarkdownViewer markdown={issue.body} />
        {:else}
          <p class="text-muted-foreground text-sm">无描述</p>
        {/if}
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>
