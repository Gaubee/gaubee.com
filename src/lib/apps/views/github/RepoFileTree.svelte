<!--
	RepoFileTree：递归文件树组件（修复扁平遍历 BUG）。

	BUG 根因（旧实现）：{#each [...expanded].sort() as dir} 按路径字符串字典序遍历
	扁平 Set，子目录路径大于父目录，导致渲染到列表末尾；固定 ml-3 缩进无递归。

	修复：本组件递归自包含，每个目录的子项渲染在父目录 <div> 内部，
	缩进由 DOM 嵌套自然产生，展开/折叠只影响该目录子树。

	数据流：目录懒加载。首次展开某目录时调 onLoadDir(dir) 拉取内容。
	父组件维护 tree Map<string, TreeNode> 与 expanded Set<string>，
	通过回调通知状态变更（受控模式，便于详情页统一管理）。
-->
<script lang="ts">
  import type { GhContentEntry } from '$lib/github/client'
  import FolderIcon from '@lucide/svelte/icons/folder'
  import FileTextIcon from '@lucide/svelte/icons/file-text'
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right'
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw'
  // self-import（Svelte 5 推荐的递归组件方式，替代已废弃的 <svelte:self>）
  import RepoFileTree from './RepoFileTree.svelte'

  /** 树节点：目录的直系条目。 */
  export interface TreeNode {
    dirs: GhContentEntry[]
    files: GhContentEntry[]
  }

  let {
    /** 当前目录路径（'' 表示根）。 */
    dir,
    /** 当前目录的显示名（根目录显示 '根目录'）。 */
    label,
    /** 缩进层级（根=0）。 */
    depth = 0,
    /** 完整的树数据（目录路径 → 节点）。 */
    tree,
    /** 已展开的目录路径集合。 */
    expanded,
    /** 当前选中文件 path。 */
    selectedFile = null,
    /** 加载中的目录集合。 */
    loadingDirs = new Set<string>(),
    /** 事件回调：切换目录展开状态。 */
    ontoggledir = () => {},
    /** 事件回调：选中文件。 */
    onselectfile = () => {},
  }: {
    dir: string
    label: string
    depth?: number
    tree: Map<string, TreeNode>
    expanded: Set<string>
    selectedFile?: string | null
    loadingDirs?: Set<string>
    ontoggledir?: (dir: string) => void
    onselectfile?: (path: string) => void
  } = $props()

  const node = $derived(tree.get(dir))
  const isOpen = $derived(expanded.has(dir))
  const isLoading = $derived(loadingDirs.has(dir))
</script>

<div class="select-none">
  <!-- 当前目录行（根目录不显示，由父容器直接展示内容）-->
  {#if depth > 0}
    <button
      class="hover:bg-accent flex w-full items-center gap-1 rounded px-1 py-1 text-left text-xs"
      style="padding-left: {depth * 12}px"
      onclick={() => ontoggledir(dir)}
    >
      <ChevronRightIcon class="size-3 shrink-0 transition-transform {isOpen ? 'rotate-90' : ''}" />
      <FolderIcon class="size-3.5 shrink-0 text-amber-500" />
      <span class="truncate">{label}</span>
      {#if isLoading}
        <RefreshCwIcon class="size-3 animate-spin" />
      {/if}
    </button>
  {/if}

  <!-- 展开时渲染子项（递归）-->
  {#if depth === 0 || isOpen}
    {#if node}
      <div>
        {#each node.dirs as d (d.path)}
          {@const childOpen = expanded.has(d.path)}
          {@const childNode = tree.get(d.path)}
          {#if childOpen && childNode}
            <!-- 已加载且展开：递归渲染子目录树 -->
            <RepoFileTree
              dir={d.path}
              label={d.name}
              depth={depth + 1}
              {tree}
              {expanded}
              {selectedFile}
              {loadingDirs}
              {ontoggledir}
              {onselectfile}
            />
          {:else}
            <!-- 未加载或未展开：只渲染目录行（点击时父组件负责加载+展开）-->
            <button
              class="hover:bg-accent flex w-full items-center gap-1 rounded px-1 py-1 text-left text-xs"
              style="padding-left: {(depth + 1) * 12}px"
              onclick={() => ontoggledir(d.path)}
            >
              <ChevronRightIcon class="size-3 shrink-0 transition-transform {childOpen ? 'rotate-90' : ''}" />
              <FolderIcon class="size-3.5 shrink-0 text-amber-500" />
              <span class="truncate">{d.name}</span>
              {#if loadingDirs.has(d.path)}
                <RefreshCwIcon class="size-3 animate-spin" />
              {/if}
            </button>
            <!-- 展开但未加载完成时显示加载占位 -->
            {#if childOpen && !childNode}
              <div class="text-muted-foreground py-0.5 text-xs" style="padding-left: {(depth + 2) * 12}px">
                加载中…
              </div>
            {/if}
          {/if}
        {/each}
        {#each node.files as f (f.path)}
          <button
            class="hover:bg-accent flex w-full items-center gap-1.5 rounded px-1 py-1 text-left text-xs {selectedFile === f.path ? 'bg-accent' : ''}"
            style="padding-left: {(depth + 1) * 12 + 4}px"
            onclick={() => onselectfile(f.path)}
          >
            <FileTextIcon class="size-3.5 shrink-0 text-muted-foreground" />
            <span class="truncate">{f.name}</span>
          </button>
        {/each}
      </div>
    {:else if depth === 0}
      <div class="text-muted-foreground py-2 text-center text-xs">加载中…</div>
    {/if}
  {/if}
</div>
