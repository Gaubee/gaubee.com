<!--
	FileTreeContextMenu：GithubEditor 文件树右键菜单。

	2026-08-02：为 FileTree 节点提供上下文菜单。
	采用受控模式：父组件管理 open 状态 + target（当前右键的节点），本组件只渲染菜单项。
	菜单项（按节点类型显示）：
	- 文件 + 目录：重命名 / 复制路径 / 复制 / 剪切
	- 目录额外：粘贴（仅剪贴板非空时）/ 上传图片到这里
	- 文件 + 目录：删除
	所有操作通过回调透传给父组件（EditorWorkspace）执行实际的 VFS 操作。
-->
<script lang="ts">
  import * as ContextMenu from '$lib/components/ui/context-menu'
  import PencilIcon from '@lucide/svelte/icons/pencil'
  import CopyIcon from '@lucide/svelte/icons/copy'
  import ScissorsIcon from '@lucide/svelte/icons/scissors'
  import ClipboardPasteIcon from '@lucide/svelte/icons/clipboard-paste'
  import Trash2Icon from '@lucide/svelte/icons/trash-2'
  import UploadIcon from '@lucide/svelte/icons/upload'
  import type { FileClipboardEntry } from '../clipboard.svelte'

  /** 当前右键目标节点信息。 */
  export interface ContextTarget {
    path: string
    isDir: boolean
  }

  let {
    open = $bindable(false),
    target,
    /** 剪贴板当前内容（控制「粘贴」项是否可用）。 */
    clipboardEntry,
    onRename,
    onCopyPath,
    onCopy,
    onCut,
    onPaste,
    onDelete,
    onUploadImageHere,
  }: {
    open?: boolean
    target: ContextTarget | null
    clipboardEntry?: FileClipboardEntry | null
    onRename: () => void
    onCopyPath: () => void
    onCopy: () => void
    onCut: () => void
    onPaste: () => void
    onDelete: () => void
    onUploadImageHere: () => void
  } = $props()

  function run(fn: () => void) {
    return () => {
      open = false
      fn()
    }
  }
</script>

<ContextMenu.Root bind:open>
  <!-- 隐藏 trigger，由 FileTree 的 oncontextmenu 程序化控制 open -->
  <ContextMenu.Trigger class="sr-only" />
  <ContextMenu.Content>
    {#if target}
      <!-- 重命名 -->
      <ContextMenu.Item onclick={run(onRename)}>
        <PencilIcon class="size-4" />
        <span>重命名</span>
        <ContextMenu.Shortcut>F2</ContextMenu.Shortcut>
      </ContextMenu.Item>
      <!-- 复制路径 -->
      <ContextMenu.Item onclick={run(onCopyPath)}>
        <CopyIcon class="size-4" />
        <span>复制路径</span>
      </ContextMenu.Item>
      <ContextMenu.Separator />
      <!-- 复制 / 剪切 -->
      <ContextMenu.Item onclick={run(onCopy)}>
        <CopyIcon class="size-4" />
        <span>复制</span>
        <ContextMenu.Shortcut>⌘C</ContextMenu.Shortcut>
      </ContextMenu.Item>
      <ContextMenu.Item onclick={run(onCut)}>
        <ScissorsIcon class="size-4" />
        <span>剪切</span>
        <ContextMenu.Shortcut>⌘X</ContextMenu.Shortcut>
      </ContextMenu.Item>
      <!-- 粘贴（仅目录 + 剪贴板非空） -->
      {#if target.isDir && clipboardEntry}
        <ContextMenu.Item onclick={run(onPaste)}>
          <ClipboardPasteIcon class="size-4" />
          <span>粘贴到此处</span>
          <ContextMenu.Shortcut>⌘V</ContextMenu.Shortcut>
        </ContextMenu.Item>
      {/if}
      <!-- 上传图片到这里（仅目录） -->
      {#if target.isDir}
        <ContextMenu.Item onclick={run(onUploadImageHere)}>
          <UploadIcon class="size-4" />
          <span>上传图片到这里</span>
        </ContextMenu.Item>
      {/if}
      <ContextMenu.Separator />
      <!-- 删除 -->
      <ContextMenu.Item onclick={run(onDelete)} class="text-destructive focus:text-destructive">
        <Trash2Icon class="size-4" />
        <span>删除</span>
      </ContextMenu.Item>
    {/if}
  </ContextMenu.Content>
</ContextMenu.Root>
