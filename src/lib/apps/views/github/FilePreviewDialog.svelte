<!--
	FilePreviewDialog：文件预览 Dialog（GithubApp 详情页文件 Tab 用）。

	功能：
	- 拉取文件内容（getFileText），判断类型（markdown / 代码 / 纯文本）。
	- markdown 用 MarkdownViewer 渲染；代码/文本用 <pre> 展示。
	- 编辑按钮（仅主仓库可写）：跳转 EditorView raw 模式。
	- 大文件截断提示。

	由 RepoDetailView 控制 open 状态（受控），传入 path + owner + repo。
-->
<script lang="ts">
  import { getFileText, OWNER, REPO } from '$lib/github/client'
  import { navController } from '$lib/nav/nav-controller-instance'
  import MarkdownViewer from '$lib/markdown/MarkdownViewer.svelte'
  import { Button } from '$lib/components/ui/button'
  import { Badge } from '$lib/components/ui/badge'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import * as Dialog from '$lib/components/ui/dialog'
  import FileTextIcon from '@lucide/svelte/icons/file-text'
  import PencilIcon from '@lucide/svelte/icons/pencil'
  import XIcon from '@lucide/svelte/icons/x'

  let {
    open = $bindable(false),
    path = '',
    owner,
    repo,
  }: {
    open?: boolean
    path: string
    owner: string
    repo: string
  } = $props()

  let content = $state('')
  let loading = $state(false)
  let error = $state<string | null>(null)

  const isMainRepo = $derived(owner === OWNER && repo === REPO)
  const isMarkdown = $derived(/\.md$/i.test(path))
  /** 文件大小阈值（超过 200KB 不渲染，提示用户）。 */
  const MAX_RENDER = 200 * 1024

  // path 变化时加载
  $effect(() => {
    const p = path
    if (!open || !p) return
    void loadContent(p)
  })

  async function loadContent(p: string) {
    loading = true
    error = null
    content = ''
    try {
      content = await getFileText(p, { owner, repo })
    } catch (e) {
      error = e instanceof Error ? e.message : '加载失败'
    } finally {
      loading = false
    }
  }

  function handleEdit() {
    if (!isMainRepo) return
    open = false
    navController.navigateMain(`/app/github-edit/${owner}/${repo}/${path}`)
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-h-[85vh] max-w-3xl overflow-hidden p-0" showCloseButton={false}>
    <Dialog.Header class="flex-row items-center gap-2 border-b border-border px-4 py-3">
      <FileTextIcon class="size-4 shrink-0 text-muted-foreground" />
      <Dialog.Title class="truncate font-mono text-sm">{path}</Dialog.Title>
      {#if isMainRepo}
        <Badge variant="default" class="ml-1 text-[10px]">可编辑</Badge>
      {/if}
      <div class="ml-auto flex items-center gap-1">
        {#if isMainRepo}
          <Button size="sm" variant="ghost" class="gap-1" onclick={handleEdit}>
            <PencilIcon class="size-4" />
            <span class="hidden sm:inline">编辑</span>
          </Button>
        {/if}
        <Dialog.Close>
          <Button variant="ghost" size="icon-sm" aria-label="关闭">
            <XIcon class="size-4" />
          </Button>
        </Dialog.Close>
      </div>
    </Dialog.Header>

    <div class="max-h-[70vh] overflow-auto p-4">
      {#if loading}
        <Skeleton class="h-40" />
      {:else if error}
        <p class="text-destructive text-sm">{error}</p>
      {:else if content.length > MAX_RENDER}
        <div class="text-muted-foreground py-8 text-center text-sm">
          <p>文件过大（{Math.round(content.length / 1024)} KB），不支持预览。</p>
          {#if isMainRepo}
            <Button size="sm" variant="outline" class="mt-3" onclick={handleEdit}>在编辑器中打开</Button>
          {/if}
        </div>
      {:else if isMarkdown}
        <MarkdownViewer markdown={content} />
      {:else}
        <pre class="bg-muted/50 overflow-auto rounded p-3 text-xs leading-relaxed whitespace-pre-wrap">{content}</pre>
      {/if}
    </div>
  </Dialog.Content>
</Dialog.Root>
