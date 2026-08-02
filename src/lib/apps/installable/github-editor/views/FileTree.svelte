<!--
	FileTree：GithubEditor 递归文件树（从 EditorWorkspace 抽出）。

	2026-08-02：替换 EditorWorkspace 内联的简化版（仅根+一层）为真正递归渲染。
	职责单一：只负责渲染 + 事件透传。右键菜单/拖拽处理由父组件通过回调管理。

	能力：
	- 递归渲染任意深度的目录/文件
	- 节点点击：目录展开/折叠，文件选中
	- 拖拽：目录接收 drop（文件移动 / 图片上传到该目录）
	- 右键：透传 onContextMenu，父组件决定弹什么菜单
	- 重命名：内联 input（renamingPath 控制）

	数据结构（与 EditorWorkspace 兼容）：
	- tree: Map<string, TreeNode>，key=目录 path（根=''）
	- TreeNode = { dirs: [{name,path}], files: [{name,path}] }
	- expanded: Set<string>
-->
<script lang="ts">
  import FolderIcon from '@lucide/svelte/icons/folder'
  import FolderOpenIcon from '@lucide/svelte/icons/folder-open'
  import FileTextIcon from '@lucide/svelte/icons/file-text'
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right'
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down'

  /** 树数据：目录 path → 该目录直接子节点。根目录 key 为 ''。 */
  export interface TreeNode {
    dirs: Array<{ name: string; path: string }>
    files: Array<{ name: string; path: string }>
  }

  /** 拖拽落点指示（用于高亮目标目录）。 */
  export type DropTarget = { path: string } | null

  let {
    tree,
    expanded,
    selectedFile,
    /** 正在重命名的节点 path（显示内联 input）。null=非编辑态。 */
    renamingPath = null,
    /** 当前悬停的拖拽目标目录（高亮用）。 */
    dropTarget = null,
    onSelect,
    onToggleDir,
    onDragStart,
    onDragOverDir,
    onDragLeaveDir,
    onDropOnDir,
    onContextMenu,
    onRenameCommit,
    onRenameCancel,
  }: {
    tree: Map<string, TreeNode>
    expanded: Set<string>
    selectedFile: string
    renamingPath?: string | null
    dropTarget?: DropTarget
    onSelect: (path: string) => void
    onToggleDir: (dir: string) => void
    onDragStart?: (path: string, isDir: boolean, e: DragEvent) => void
    onDragOverDir?: (dir: string, e: DragEvent) => void
    onDragLeaveDir?: (dir: string) => void
    onDropOnDir?: (dir: string, e: DragEvent) => void
    onContextMenu?: (path: string, isDir: boolean, e: MouseEvent) => void
    onRenameCommit?: (oldPath: string, newPath: string) => void
    onRenameCancel?: () => void
  } = $props()

  // ---- 重命名 input 状态 ----
  let renameInputEl = $state<HTMLInputElement | null>(null)
  let renameValue = $state('')

  // renamingPath 变化时，初始化 input 值并聚焦
  $effect(() => {
    const target = renamingPath
    if (target && renameInputEl) {
      const name = target.split('/').pop() ?? ''
      const dotIdx = name.lastIndexOf('.')
      renameValue = dotIdx > 0 ? name.slice(0, dotIdx) : name
      renameInputEl.focus()
      renameInputEl.select()
    }
  })

  function isDirExpanded(dir: string): boolean {
    return expanded.has(dir)
  }

  function isDropOn(dir: string): boolean {
    return dropTarget?.path === dir
  }

  function basename(path: string): string {
    return path.split('/').pop() ?? path
  }

  function dirname(path: string): string {
    const idx = path.lastIndexOf('/')
    return idx >= 0 ? path.slice(0, idx) : ''
  }

  /** 重命名 input 键盘处理：Enter 提交，Escape 取消。 */
  function handleRenameKey(e: KeyboardEvent, oldPath: string): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      const newName = renameValue.trim()
      if (!newName) {
        onRenameCancel?.()
        return
      }
      const dir = dirname(oldPath)
      // 保留原扩展名（文件名修改时扩展名通常不变）
      const slashIdx = oldPath.lastIndexOf('/')
      const dotIdx = oldPath.lastIndexOf('.')
      const hasExt = dotIdx > slashIdx
      const ext = hasExt ? oldPath.slice(dotIdx) : ''
      const newPath = dir ? `${dir}/${newName}${ext}` : `${newName}${ext}`
      if (newPath === oldPath) {
        onRenameCancel?.()
      } else {
        onRenameCommit?.(oldPath, newPath)
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onRenameCancel?.()
    }
  }
</script>

<div class="select-none p-2 text-xs">
  {@render renderLevel('')}
</div>

{#snippet renderLevel(dir: string)}
  {@const node = tree.get(dir)}
  {#if node}
    <!-- 子目录 -->
    {#each node.dirs as d (d.path)}
      {@const expandedDir = isDirExpanded(d.path)}
      {@const dropping = isDropOn(d.path)}
      {#if renamingPath === d.path}
        <!-- 重命名 input（目录） -->
        <div class="flex items-center gap-1 rounded px-1.5 py-1">
          <FolderIcon class="size-3.5 shrink-0 text-amber-500" />
          <input
            bind:this={renameInputEl}
            bind:value={renameValue}
            onkeydown={(e) => handleRenameKey(e, d.path)}
            onblur={() => onRenameCancel?.()}
            class="bg-background focus:border-ring min-w-0 flex-1 rounded border px-1 py-0.5 text-xs outline-none"
          />
        </div>
      {:else}
        <!-- 目录节点 -->
        <div
          role="button"
          tabindex="0"
          draggable="true"
          onclick={() => onToggleDir(d.path)}
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleDir(d.path) } }}
          ondragstart={(e) => onDragStart?.(d.path, true, e)}
          ondragover={(e) => onDragOverDir?.(d.path, e)}
          ondragleave={() => onDragLeaveDir?.(d.path)}
          ondrop={(e) => onDropOnDir?.(d.path, e)}
          oncontextmenu={(e) => onContextMenu?.(d.path, true, e)}
          class="hover:bg-accent flex w-full cursor-pointer items-center gap-1 rounded px-1.5 py-1 text-left transition-colors {dropping ? 'bg-accent ring-1 ring-ring' : ''}"
        >
          {#if expandedDir}
            <ChevronDownIcon class="size-3 shrink-0" />
            <FolderOpenIcon class="size-3.5 shrink-0 text-amber-500" />
          {:else}
            <ChevronRightIcon class="size-3 shrink-0" />
            <FolderIcon class="size-3.5 shrink-0 text-amber-500" />
          {/if}
          <span class="truncate">{d.name}</span>
        </div>
      {/if}
      <!-- 递归子目录 -->
      {#if expandedDir && tree.has(d.path)}
        <div class="pl-3">
          {@render renderLevel(d.path)}
        </div>
      {/if}
    {/each}
    <!-- 子文件 -->
    {#each node.files as f (f.path)}
      {#if renamingPath === f.path}
        <!-- 重命名 input（文件） -->
        <div class="flex items-center gap-1 rounded pl-8 pr-1.5 py-1">
          <FileTextIcon class="size-3.5 shrink-0 text-muted-foreground" />
          <input
            bind:this={renameInputEl}
            bind:value={renameValue}
            onkeydown={(e) => handleRenameKey(e, f.path)}
            onblur={() => onRenameCancel?.()}
            class="bg-background focus:border-ring min-w-0 flex-1 rounded border px-1 py-0.5 text-xs outline-none"
          />
        </div>
      {:else}
        <!-- 文件节点 -->
        <div
          role="button"
          tabindex="0"
          draggable="true"
          onclick={() => onSelect(f.path)}
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(f.path) } }}
          ondragstart={(e) => onDragStart?.(f.path, false, e)}
          oncontextmenu={(e) => onContextMenu?.(f.path, false, e)}
          class="hover:bg-accent flex w-full cursor-pointer items-center gap-1 rounded py-1 pl-1.5 pr-1.5 text-left transition-colors {selectedFile === f.path ? 'bg-accent' : ''}"
        >
          <FileTextIcon class="size-3.5 shrink-0 text-muted-foreground" />
          <span class="truncate">{basename(f.path)}</span>
        </div>
      {/if}
    {/each}
  {/if}
{/snippet}
