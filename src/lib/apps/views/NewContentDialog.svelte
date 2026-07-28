<!--
	NewContentDialog：新建文章/说说的 Dialog 表单。

	2026-07-28：取代旧的 FilesView.createNew（自动写 vfsStore + 跳 /app/editor）。
	现在只生成路径 → 跳 GithubEditorApp 编辑（不预写文件，由编辑器创建）。

	表单：
	- 序号：自动生成（articles 4 位 / events 5 位，取 contentQuery 列表最大序号 +1），只读
	- 文件名：用户填写（slug，如 my-new-post）
	- 完整路径预览：src/content/{collection}/{序号}.{filename}.md

	确认 → oncreated(fullPath)，由父组件跳转 github-editor。
-->
<script lang="ts">
  import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
  } from '$lib/components/ui/dialog'
  import { Button } from '$lib/components/ui/button'
  import { Input } from '$lib/components/ui/input'
  import { contentQuery } from '$lib/content-pipeline/query.svelte'

  let {
    collection,
    open = $bindable(false),
    oncreated,
  }: {
    /** 内容集合（articles=文章 / events=说说）。 */
    collection: 'articles' | 'events'
    /** Dialog 开关（双向）。 */
    open?: boolean
    /** 确认回调，返回完整文件路径（如 src/content/articles/0063.my-post.md）。 */
    oncreated: (path: string) => void
  } = $props()

  /** 自动生成的序号（取现有列表最大序号 +1）。 */
  const nextSeq = $derived.by(() => {
    const list = collection === 'articles' ? contentQuery.listArticles() : contentQuery.listEvents()
    const digits = collection === 'articles' ? 4 : 5
    let maxSeq = 0
    for (const item of list) {
      const m = item.path.match(/\/(\d+)\./)
      if (m) maxSeq = Math.max(maxSeq, Number(m[1]))
    }
    return String(maxSeq + 1).padStart(digits, '0')
  })

  /** 用户填写的文件名（slug）。 */
  let filename = $state('')

  /** 完整路径预览。 */
  const fullPath = $derived(
    `src/content/${collection}/${nextSeq}${filename.trim() ? `.${filename.trim()}` : ''}.md`,
  )

  /** 确认按钮是否可用（filename 非空）。 */
  const canConfirm = $derived(filename.trim().length > 0)

  /** 文件名合法性：仅小写字母/数字/连字符（slug 规范）。 */
  let filenameError = $state<string | null>(null)

  function validateFilename(value: string): boolean {
    const trimmed = value.trim()
    if (trimmed.length === 0) {
      filenameError = null
      return false
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(trimmed)) {
      filenameError = '仅允许小写字母、数字、连字符（如 my-post）'
      return false
    }
    filenameError = null
    return true
  }

  function handleInput(e: Event): void {
    filename = (e.target as HTMLInputElement).value
    validateFilename(filename)
  }

  function handleConfirm(): void {
    if (!canConfirm || filenameError) return
    oncreated(fullPath)
    // 重置表单
    filename = ''
    filenameError = null
  }

  function handleOpenChange(v: boolean): void {
    if (!v) {
      filename = ''
      filenameError = null
    }
  }

  const label = $derived(collection === 'articles' ? '文章' : '说说')
</script>

<Dialog bind:open onOpenChange={handleOpenChange}>
  <DialogContent class="max-w-md">
    <DialogHeader>
      <DialogTitle>新建{label}</DialogTitle>
      <DialogDescription>填写文件名，确认后跳转编辑器编辑。</DialogDescription>
    </DialogHeader>

    <div class="space-y-3 py-2">
      <!-- 序号（自动生成，只读） -->
      <div>
        <label for="new-seq" class="text-muted-foreground mb-1 block text-xs font-medium">序号</label>
        <Input id="new-seq" value={nextSeq} readonly class="font-mono" />
      </div>

      <!-- 文件名（用户填写） -->
      <div>
        <label for="new-filename" class="text-muted-foreground mb-1 block text-xs font-medium">
          文件名（slug）
        </label>
        <Input
          id="new-filename"
          value={filename}
          oninput={handleInput}
          placeholder="如 my-new-post"
          class="font-mono"
        />
        {#if filenameError}
          <p class="text-destructive mt-1 text-xs">{filenameError}</p>
        {/if}
      </div>

      <!-- 完整路径预览 -->
      <div>
        <p class="text-muted-foreground mb-1 text-xs font-medium">完整路径</p>
        <code class="bg-muted block truncate rounded px-2 py-1.5 font-mono text-xs">{fullPath}</code>
      </div>
    </div>

    <DialogFooter>
      <Button variant="outline" onclick={() => (open = false)}>取消</Button>
      <Button onclick={handleConfirm} disabled={!canConfirm || !!filenameError}>
        新建并编辑
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
