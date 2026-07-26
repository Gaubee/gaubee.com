<!--
	CommentEditor：GithubApp Issues 评论编辑器。

	功能：
	- Write | Preview 切换（Write=CodeMirror 编辑器，Preview=MarkdownViewer 渲染）
	- Markdown 工具栏（粗体/斜体/链接/图片/代码/列表/引用/@）
	- 草稿自动保存（IndexedDB，debounce 1s），挂载时恢复，提交后删除
	- 图片粘贴/拖拽上传（uploadIssueImage，成功后插入 ![](url)）
	- 提交按钮（disabled 当 body 为空或提交中）

	实现说明（CodeMirror 同步）：
	CodeMirror.svelte 只在 docId 变化时把外部 doc 同步进 CM（避免按键反馈循环）。
	因此 toolbar 按钮点击后，除修改 body 外还需变更 docId 才能让 CM 重载新内容。
	首版接受光标重置，TODO: 后续给 CodeMirror 暴露 ref（dispatch transaction）保留光标。
-->
<script lang="ts">
  import { onMount, onDestroy, untrack } from 'svelte'
  import CodeMirror from '$lib/editor/CodeMirror.svelte'
  import MarkdownViewer from '$lib/markdown/MarkdownViewer.svelte'
  import { uploadIssueImage } from '$lib/apps/installable/github/issue-api'
  import { draftGet, draftPut, draftDelete } from '$lib/vfs/meta-store'
  import { Button } from '$lib/components/ui/button'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import { notifyError } from '$lib/apps/builtin/notifications/service.svelte'
  import BoldIcon from '@lucide/svelte/icons/bold'
  import ItalicIcon from '@lucide/svelte/icons/italic'
  import LinkIcon from '@lucide/svelte/icons/link'
  import ImageIcon from '@lucide/svelte/icons/image'
  import CodeIcon from '@lucide/svelte/icons/code'
  import ListIcon from '@lucide/svelte/icons/list'
  import ListChecksIcon from '@lucide/svelte/icons/list-checks'
  import HeadingIcon from '@lucide/svelte/icons/heading'
  import QuoteIcon from '@lucide/svelte/icons/quote'
  import AtSignIcon from '@lucide/svelte/icons/at-sign'
  import LoaderIcon from '@lucide/svelte/icons/loader-circle'
  import EyeIcon from '@lucide/svelte/icons/eye'
  import PencilIcon from '@lucide/svelte/icons/pencil'
  import SendIcon from '@lucide/svelte/icons/send'
  import XIcon from '@lucide/svelte/icons/x'

  let {
    owner,
    repo,
    issueNumber,
    commentId,
    initialBody = '',
    placeholder = '留下你的评论...',
    submitLabel = '评论',
    onSubmit,
    onCancel,
    issueState,
    onToggleIssue,
  }: {
    owner: string
    repo: string
    issueNumber?: number
    commentId?: number
    initialBody?: string
    placeholder?: string
    submitLabel?: string
    onSubmit: (body: string) => Promise<void>
    onCancel?: () => void
    /** 当前 issue 状态（'open' | 'closed'），用于显示 Close/Reopen 按钮。 */
    issueState?: 'open' | 'closed'
    /** 切换 issue 状态（Close/Reopen）回调。 */
    onToggleIssue?: () => Promise<void>
  } = $props()

  /** 当前 tab：write | preview。 */
  let tab = $state<'write' | 'preview'>('write')
  /** 评论正文（markdown 原文）。untrack：仅取 initialBody 初始值，后续不跟随 prop 变化。 */
  let body = $state(untrack(() => initialBody))
  /**
   * 文档身份标识。CodeMirror 在 docId 变化时强制重载 doc。
   * toolbar 插入语法后递增 docIdSeq 触发重载（首版简化方案，接受光标重置）。
   */
  let docIdSeq = $state(0)
  /** 是否正在提交评论。 */
  let submitting = $state(false)
  /** 是否正在上传图片。 */
  let uploading = $state(false)
  /** 是否正在从 IndexedDB 恢复草稿（首屏骨架用）。 */
  let restoring = $state(true)

  /** 草稿 key：新评论用 issue 标识，编辑用 comment 标识。 */
  const draftKey = $derived(
    commentId != null ? `comment-${commentId}` : `${owner}/${repo}#${issueNumber ?? 'inline'}`,
  )
  /** CodeMirror docId（拼上 seq，变化即触发重载）。 */
  const cmDocId = $derived(`${draftKey}#${docIdSeq}`)

  /** 提交按钮是否禁用：内容为空或正在提交。 */
  const canSubmit = $derived(body.trim().length > 0 && !submitting && !uploading)
  /** 是否正在切换 issue 状态。 */
  let togglingIssue = $state(false)

  async function handleToggleIssue() {
    if (!onToggleIssue || togglingIssue) return
    togglingIssue = true
    try {
      await onToggleIssue()
    } finally {
      togglingIssue = false
    }
  }

  /** 草稿自动保存 timer（debounce 1s）。 */
  let draftTimer: ReturnType<typeof setTimeout> | null = null

  // ---- 草稿恢复 ----
  onMount(async () => {
    try {
      const draft = await draftGet(draftKey)
      // 仅在草稿非空时覆盖 initialBody（避免空草稿清掉编辑模式的初始内容）
      if (draft && draft.body && draft.body.length > 0) {
        body = draft.body
        docIdSeq += 1
      }
    } catch {
      // IndexedDB 不可用时静默降级（不阻断编辑）
    } finally {
      restoring = false
    }
  })

  onDestroy(() => {
    if (draftTimer) clearTimeout(draftTimer)
  })

  // ---- 输入处理（CodeMirror onInput）----
  function handleInput(value: string) {
    body = value
    scheduleDraftSave()
  }

  /** debounce 1s 保存草稿到 IndexedDB。 */
  function scheduleDraftSave() {
    if (draftTimer) clearTimeout(draftTimer)
    draftTimer = setTimeout(async () => {
      draftTimer = null
      await saveDraft()
    }, 1000)
  }

  async function saveDraft(): Promise<void> {
    try {
      // 空内容时删除草稿（避免残留空记录）
      if (body.trim().length === 0) {
        await draftDelete(draftKey)
        return
      }
      await draftPut({
        key: draftKey,
        body,
        updatedAt: Date.now(),
      })
    } catch {
      // 草稿保存失败不阻断编辑（静默）
    }
  }

  // ---- toolbar：插入 markdown 语法 ----
  /**
   * 把片段 append 到 body 末尾并触发 CM 重载（变更 docId）。
   * TODO: 后续给 CodeMirror 暴露 EditorView ref，用 dispatch transaction
   *       在光标处插入并保留光标位置，而非 append + 重载。
   */
  function insertSyntax(snippet: string) {
    const sep = body.length > 0 && !body.endsWith('\n') ? '\n' : ''
    body = `${body}${sep}${snippet}`
    // 变更 docId 触发 CM 重载（接受光标重置）
    docIdSeq += 1
    scheduleDraftSave()
    // 切回 write tab（preview 模式下点击 toolbar 应回到编辑）
    tab = 'write'
  }

  function insertBold() {
    insertSyntax('**粗体**')
  }
  function insertItalic() {
    insertSyntax('*斜体*')
  }
  function insertLink() {
    insertSyntax('[链接文字](https://)')
  }
  function insertImage() {
    insertSyntax('![图片描述](https://)')
  }
  function insertCode() {
    insertSyntax('\n```\n代码\n```\n')
  }
  function insertList() {
    insertSyntax('- 列表项')
  }
  function insertTaskList() {
    insertSyntax('- [ ] 待办项')
  }
  function insertHeading() {
    insertSyntax('## 标题')
  }
  function insertQuote() {
    insertSyntax('> 引用')
  }
  function insertMention() {
    // TODO: 后续用 @codemirror/autocomplete 实现 @mention 自动补全
    // （输入 @ 后触发 searchUsers，弹出用户列表）
    insertSyntax('@')
  }

  // ---- 图片粘贴/拖拽上传 ----
  /**
   * 从 paste/drop 事件中提取首个图片 File。
   * @returns 图片 File 或 null（非图片）
   */
  function pickImageFile(e: ClipboardEvent | DragEvent): File | null {
    // paste：clipboardData；drop：dataTransfer
    const files =
      e instanceof ClipboardEvent
        ? e.clipboardData?.files
        : e.dataTransfer?.files
    if (!files || files.length === 0) return null
    for (const f of Array.from(files)) {
      if (f.type.startsWith('image/')) return f
    }
    return null
  }

  async function handleImageUpload(file: File): Promise<void> {
    uploading = true
    try {
      const url = await uploadIssueImage(owner, repo, file)
      const snippet = `![${file.name || 'image'}](${url})`
      insertSyntax(snippet)
    } catch (e) {
      notifyError('图片上传失败', e instanceof Error ? e.message : undefined)
    } finally {
      uploading = false
    }
  }

  function handlePaste(e: ClipboardEvent) {
    const file = pickImageFile(e)
    if (!file) return
    e.preventDefault()
    void handleImageUpload(file)
  }

  function handleDrop(e: DragEvent) {
    const file = pickImageFile(e)
    if (!file) return
    e.preventDefault()
    void handleImageUpload(file)
  }

  // ---- 提交 ----
  async function handleSubmit() {
    if (!canSubmit) return
    submitting = true
    try {
      await onSubmit(body.trim())
      // 提交成功：清空编辑器 + 删除草稿
      body = ''
      docIdSeq += 1
      if (draftTimer) {
        clearTimeout(draftTimer)
        draftTimer = null
      }
      try {
        await draftDelete(draftKey)
      } catch {
        // 删除草稿失败不阻断
      }
    } finally {
      submitting = false
    }
  }

  function handleCancel() {
    onCancel?.()
  }
</script>

<div class="flex flex-col rounded-2xl border border-border bg-background">
  <!-- 顶部 tab：Write | Preview -->
  <div class="flex items-center gap-1 border-b border-border px-2 py-1.5">
    <button
      type="button"
      class="hover:bg-muted flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors {tab ===
      'write'
        ? 'bg-muted text-foreground'
        : 'text-muted-foreground'}"
      onclick={() => (tab = 'write')}
    >
      <PencilIcon class="size-3.5" />
      Write
    </button>
    <button
      type="button"
      class="hover:bg-muted flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors {tab ===
      'preview'
        ? 'bg-muted text-foreground'
        : 'text-muted-foreground'}"
      onclick={() => (tab = 'preview')}
    >
      <EyeIcon class="size-3.5" />
      Preview
    </button>

    <!-- 右侧状态指示（上传中） -->
    {#if uploading}
      <span class="text-muted-foreground ml-auto flex items-center gap-1 text-xs">
        <LoaderIcon class="size-3.5 animate-spin" />
        上传图片中...
      </span>
    {/if}
  </div>

  {#if tab === 'write'}
    <!-- Markdown 工具栏 -->
    <div class="flex flex-wrap items-center gap-0.5 border-b border-border px-2 py-1">
      <button
        type="button"
        class="hover:bg-muted text-muted-foreground hover:text-foreground rounded-md p-1.5 transition-colors"
        title="粗体"
        aria-label="粗体"
        onclick={insertBold}
      >
        <BoldIcon class="size-4" />
      </button>
      <button
        type="button"
        class="hover:bg-muted text-muted-foreground hover:text-foreground rounded-md p-1.5 transition-colors"
        title="斜体"
        aria-label="斜体"
        onclick={insertItalic}
      >
        <ItalicIcon class="size-4" />
      </button>
      <span class="bg-border mx-1 h-4 w-px"></span>
      <button
        type="button"
        class="hover:bg-muted text-muted-foreground hover:text-foreground rounded-md p-1.5 transition-colors"
        title="链接"
        aria-label="链接"
        onclick={insertLink}
      >
        <LinkIcon class="size-4" />
      </button>
      <button
        type="button"
        class="hover:bg-muted text-muted-foreground hover:text-foreground rounded-md p-1.5 transition-colors"
        title="图片"
        aria-label="图片"
        onclick={insertImage}
      >
        <ImageIcon class="size-4" />
      </button>
      <button
        type="button"
        class="hover:bg-muted text-muted-foreground hover:text-foreground rounded-md p-1.5 transition-colors"
        title="代码"
        aria-label="代码"
        onclick={insertCode}
      >
        <CodeIcon class="size-4" />
      </button>
      <span class="bg-border mx-1 h-4 w-px"></span>
      <button
        type="button"
        class="hover:bg-muted text-muted-foreground hover:text-foreground rounded-md p-1.5 transition-colors"
        title="列表"
        aria-label="列表"
        onclick={insertList}
      >
        <ListIcon class="size-4" />
      </button>
      <button
        type="button"
        class="hover:bg-muted text-muted-foreground hover:text-foreground rounded-md p-1.5 transition-colors"
        title="任务列表"
        aria-label="任务列表"
        onclick={insertTaskList}
      >
        <ListChecksIcon class="size-4" />
      </button>
      <button
        type="button"
        class="hover:bg-muted text-muted-foreground hover:text-foreground rounded-md p-1.5 transition-colors"
        title="标题"
        aria-label="标题"
        onclick={insertHeading}
      >
        <HeadingIcon class="size-4" />
      </button>
      <button
        type="button"
        class="hover:bg-muted text-muted-foreground hover:text-foreground rounded-md p-1.5 transition-colors"
        title="引用"
        aria-label="引用"
        onclick={insertQuote}
      >
        <QuoteIcon class="size-4" />
      </button>
      <span class="bg-border mx-1 h-4 w-px"></span>
      <button
        type="button"
        class="hover:bg-muted text-muted-foreground hover:text-foreground rounded-md p-1.5 transition-colors"
        title="@ mention（提及用户）"
        aria-label="@ mention"
        onclick={insertMention}
      >
        <AtSignIcon class="size-4" />
      </button>
    </div>

    <!-- 编辑器区域（容器绑 paste/drop 事件，捕获图片粘贴/拖拽上传） -->
    <div
      class="min-h-24"
      onpaste={handlePaste}
      ondrop={handleDrop}
      role="region"
      aria-label="评论编辑器"
    >
      {#if restoring}
        <div class="space-y-2 p-4">
          <Skeleton class="h-4 w-3/4" />
          <Skeleton class="h-4 w-1/2" />
          <Skeleton class="h-4 w-2/3" />
        </div>
      {:else}
        <CodeMirror doc={body} docId={cmDocId} {placeholder} onInput={handleInput} />
      {/if}
    </div>
  {:else}
    <!-- Preview 模式 -->
    <div class="min-h-24 p-4">
      {#if body.trim().length === 0}
        <p class="text-muted-foreground text-sm">{placeholder}</p>
      {:else}
        <MarkdownViewer markdown={body} />
      {/if}
    </div>
  {/if}

  <!-- 底部操作栏 -->
  <div class="flex items-center gap-2 border-t border-border px-3 py-2">
    <!-- Close/Reopen issue 按钮（仅新评论模式且有 issueState 时显示）-->
    {#if issueState && onToggleIssue && !commentId}
      <Button
        variant="outline"
        size="sm"
        onclick={handleToggleIssue}
        disabled={togglingIssue || submitting}
      >
        {#if togglingIssue}
          <LoaderIcon class="size-3.5 animate-spin" />
        {/if}
        {issueState === 'open' ? 'Close issue' : 'Reopen issue'}
      </Button>
    {/if}

    <div class="ml-auto flex items-center gap-2">
      {#if onCancel}
        <Button variant="ghost" size="sm" onclick={handleCancel} disabled={submitting}>
          <XIcon class="size-3.5" />
          取消
        </Button>
      {/if}
      <Button size="sm" onclick={handleSubmit} disabled={!canSubmit}>
        {#if submitting}
          <LoaderIcon class="size-3.5 animate-spin" />
          提交中...
        {:else}
          <SendIcon class="size-3.5" />
          {submitLabel}
        {/if}
      </Button>
    </div>
  </div>
</div>

<style>
  /* 让 CodeMirror 占满编辑区域高度（与 EditorView 风格一致的最小高度） */
  :global(.codemirror-host) {
    min-height: 5rem;
  }
</style>
