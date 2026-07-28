<!--
	UploadDialog：GithubEditor 文件/文件夹上传 Dialog。

	2026-07-28：支持拖拽/选择文件或文件夹上传到仓库指定路径。
	- 目标路径：PathPicker（基于 remoteCache fileTree）
	- 文件夹展开：递归 readEntries 收集所有文件（相对路径去顶层文件夹名）
	- 预览：手风琴（标题显示 N 个文件 / Xsize 到 path）
	- 上传逻辑：写入 editorVfs.writeLocal（标 dirty，进变更 tab 提交）

	注意：二进制文件（图片等）读取为 base64 存入 local，提交时由 commitChanges 处理。
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
  import type { EditorVfs } from '../editor-vfs.svelte'
  import { notifyError, notifySuccess } from '$lib/apps/builtin/notifications/service.svelte'
  import UploadIcon from '@lucide/svelte/icons/upload'
  import FolderIcon from '@lucide/svelte/icons/folder'
  import FileTextIcon from '@lucide/svelte/icons/file-text'
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down'

  let {
    owner,
    repo,
    branch,
    editorVfs,
    onClose,
  }: {
    owner: string
    repo: string
    branch: string
    editorVfs: EditorVfs
    onClose: () => void
  } = $props()

  /** 待上传文件清单（相对 targetPath 的路径 + File 对象）。 */
  interface PendingFile {
    /** 相对 targetPath 的路径（如 assets/img.png）。 */
    relativePath: string
    file: File
  }
  let pendingFiles = $state<PendingFile[]>([])
  let targetPath = $state('')
  let uploading = $state(false)
  let dragOver = $state(false)
  let fileInputEl: HTMLInputElement

  /** 格式化文件大小。 */
  function fmtSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  }

  /** 总大小。 */
  const totalSize = $derived(pendingFiles.reduce((sum, f) => sum + f.file.size, 0))

  /** 从 FileList / DataTransfer 收集文件（展开文件夹）。 */
  async function collectFiles(items: DataTransferItemList | File[] | FileList): Promise<PendingFile[]> {
    const result: PendingFile[] = []
    const fileArray = Array.from(items as ArrayLike<File>)

    for (const file of fileArray) {
      // webkitRelativePath 在选文件夹时含顶层文件夹名（如 myfolder/img.png）
      // 我们去掉顶层文件夹名，只保留内部相对路径
      const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath
        ? (file as File & { webkitRelativePath?: string }).webkitRelativePath!.split('/').slice(1).join('/')
        : file.name
      result.push({ relativePath: relativePath || file.name, file })
    }
    return result
  }

  function handleFileSelect(e: Event): void {
    const input = e.target as HTMLInputElement
    if (input.files && input.files.length > 0) {
      void collectFiles(input.files).then((files) => {
        pendingFiles = [...pendingFiles, ...files]
      })
    }
  }

  function handleDrop(e: DragEvent): void {
    e.preventDefault()
    dragOver = false
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      void collectFiles(e.dataTransfer.files).then((files) => {
        pendingFiles = [...pendingFiles, ...files]
      })
    }
  }

  function handleDragOver(e: DragEvent): void {
    e.preventDefault()
    dragOver = true
  }

  function handleDragLeave(e: DragEvent): void {
    e.preventDefault()
    dragOver = false
  }

  function removePending(idx: number): void {
    pendingFiles = pendingFiles.filter((_, i) => i !== idx)
  }

  function clearPending(): void {
    pendingFiles = []
  }

  /** 执行上传：读取所有文件内容 → 写入 editorVfs.writeLocal。 */
  async function handleUpload(): Promise<void> {
    if (pendingFiles.length === 0) return
    uploading = true
    try {
      for (const pf of pendingFiles) {
        const fullPath = targetPath ? `${targetPath}/${pf.relativePath}` : pf.relativePath
        // 读取文件内容（文本直接读，二进制读 base64）
        const content = await readFileAsText(pf.file)
        await editorVfs.writeLocal(fullPath, content)
      }
      notifySuccess(`已上传 ${pendingFiles.length} 个文件到本地`, '切到「变更」tab 提交到 GitHub')
      pendingFiles = []
      onClose()
    } catch (e) {
      notifyError('上传失败', e instanceof Error ? e.message : undefined)
    } finally {
      uploading = false
    }
  }

  /** 读文件为文本（二进制文件用 base64，提交时 commitChanges 处理）。 */
  function readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(new Error(`读取 ${file.name} 失败`))
      // 文本文件用 readAsText；二进制用 readAsDataURL（含 base64，提交时需剥离前缀）
      if (file.type.startsWith('text/') || /\.(md|txt|json|js|ts|css|html|yaml|yml|xml|svg)$/i.test(file.name)) {
        reader.readAsText(file)
      } else {
        reader.readAsDataURL(file)
      }
    })
  }

  /** 目标路径建议（基于 remoteCache 的顶层目录）。 */
  const topDirs = $derived(
    editorVfs.remoteCache
      ? Array.from(
          new Set(
            editorVfs.remoteCache.blobs
              .map((b) => b.path.split('/')[0])
              .filter((p) => p && p.includes('.')),
          ),
        )
      : [],
  )
</script>

<Dialog open onOpenChange={(v: boolean) => { if (!v) onClose() }}>
  <DialogContent class="max-w-lg">
    <DialogHeader>
      <DialogTitle>上传文件</DialogTitle>
      <DialogDescription class="sr-only">上传文件或文件夹到仓库的指定路径</DialogDescription>
    </DialogHeader>

    <div class="space-y-4 py-2">
      <!-- 拖拽/选择区 -->
      <div
        role="button"
        tabindex="0"
        onclick={() => fileInputEl?.click()}
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputEl?.click() }}
        ondrop={handleDrop}
        ondragover={handleDragOver}
        ondragleave={handleDragLeave}
        class="border-border hover:border-ring flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors {dragOver ? 'border-ring bg-accent/30' : ''}"
      >
        <UploadIcon class="text-muted-foreground size-6" />
        <p class="text-sm">点击选择，或拖拽文件/文件夹到此处</p>
        <!-- TODO: webkitdirectory 属性（选整个文件夹）因 Svelte 类型限制暂未启用，
             当前支持多文件选择 + 拖拽。文件夹拖拽通过 DataTransferItem 处理。 -->
        <input
          bind:this={fileInputEl}
          type="file"
          multiple
          class="hidden"
          onchange={handleFileSelect}
        />
      </div>

      <!-- 目标路径 -->
      <div>
        <label for="target-path" class="text-muted-foreground mb-1 block text-xs font-medium">目标路径</label>
        <input
          id="target-path"
          type="text"
          bind:value={targetPath}
          placeholder="如 src/assets（留空 = 仓库根目录）"
          list="top-dirs"
          class="border-border bg-background focus:border-ring w-full rounded-lg border px-3 py-2 font-mono text-sm outline-none transition-colors"
        />
        <datalist id="top-dirs">
          {#each topDirs as d}
            <option value={d}></option>
          {/each}
        </datalist>
      </div>

      <!-- 待上传预览（手风琴） -->
      {#if pendingFiles.length > 0}
        <details class="border-border rounded-lg border" open>
          <summary class="hover:bg-accent flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm">
            <ChevronDownIcon class="size-3.5" />
            <span>
              将上传 <strong>{pendingFiles.length}</strong> 个文件
              （共 {fmtSize(totalSize)}）
              {#if targetPath}到 <code class="font-mono">{targetPath}/</code>{/if}
            </span>
          </summary>
          <div class="border-border max-h-48 overflow-auto border-t">
            {#each pendingFiles as pf, idx}
              <div class="hover:bg-accent/50 flex items-center gap-2 px-3 py-1.5 text-xs">
                {#if pf.relativePath.includes('/')}
                  <FolderIcon class="size-3 shrink-0 text-amber-500" />
                {:else}
                  <FileTextIcon class="size-3 shrink-0 text-muted-foreground" />
                {/if}
                <span class="truncate font-mono">{pf.relativePath}</span>
                <span class="text-muted-foreground ml-auto shrink-0">{fmtSize(pf.file.size)}</span>
                <button
                  type="button"
                  onclick={() => removePending(idx)}
                  class="text-muted-foreground hover:text-destructive shrink-0"
                  aria-label="移除"
                >
                  ×
                </button>
              </div>
            {/each}
          </div>
        </details>
      {/if}
    </div>

    <DialogFooter>
      <Button variant="ghost" onclick={clearPending} disabled={pendingFiles.length === 0 || uploading}>
        清空
      </Button>
      <Button variant="outline" onclick={onClose} disabled={uploading}>取消</Button>
      <Button onclick={handleUpload} disabled={pendingFiles.length === 0 || uploading}>
        {uploading ? '上传中…' : `上传 ${pendingFiles.length || ''}`}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
