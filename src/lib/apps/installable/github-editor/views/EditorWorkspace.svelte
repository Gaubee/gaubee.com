<!--
	EditorWorkspace：GithubEditor 的编辑工作区（双 tab）。

	2026-07-28：VSCode 式仓库编辑器。
	- 顶部：owner/repo + RepoRefSelector（分支切换）+ 刷新 + 上传 + dirty 计数
	- 编辑 tab：左文件树（递归 + 操作）+ 右 CodeMirror（按文件类型选语言）
	- 变更 tab：左 dirty 列表 + 右行级 diff + commit message + 提交

	2026-08-02：工作区交互升级（图片上传 + 文件树操作 + 变更页升级）
	- 图片上传：工具栏两个按钮（资产/VFS）+ 拖拽遮罩分流（拖到 fileTree=VFS，拖到 code-editor=资产）+ 粘贴上传
	- 文件树操作：递归 FileTree 组件 + 右键菜单（重命名/复制路径/复制/剪切/粘贴/删除/上传图片）
	- 变更页：每项支持 discard（撤销单文件）+ 定位到 fileTree

	数据流：
	- 进入页面 → createEditorVfs(owner, repo) → loadLocal + loadRemote(branch)
	- 编辑文件 → writeLocal（标 dirty，不立即提交）
	- 变更 tab → diff() 列表 + fileContentDiff(path) 行级 diff
	- 提交 → commit(message, branch) → 清空 local
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import { useParams, useSearch } from '$lib/router'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { createEditorVfs, type EditorVfs, type FileDiff } from '../editor-vfs.svelte'
  import { createFileOps } from '../file-ops.svelte'
  import { fileClipboard } from '../clipboard.svelte'
  import {
    uploadImageAsAsset,
    uploadImageToVfs,
    pickFirstImage,
    hasImageFiles,
    buildImageMarkdown,
  } from '../image-upload'
  import { copyText } from '$lib/utils/clipboard'
  import { getRepo, type RepoSummary } from '$lib/apps/installable/github/repo-api'
  import RepoRefSelector from '$lib/apps/views/github/RepoRefSelector.svelte'
  import { recentRepos } from '../recent-repos.svelte'
  import { notifySuccess, notifyError } from '$lib/apps/builtin/notifications/service.svelte'
  import CodeMirror, { type CodeMirrorApi } from '$lib/editor/CodeMirror.svelte'
  import MarkdownViewer from '$lib/markdown/MarkdownViewer.svelte'
  import UploadDialog from './UploadDialog.svelte'
  import FileTree, { type TreeNode } from './FileTree.svelte'
  import FileTreeContextMenu, { type ContextTarget } from './FileTreeContextMenu.svelte'
  import { getFileKind } from '$lib/github/file-kind'
  import { diffLines, type DiffLine } from '$lib/utils/diff'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import { Button } from '$lib/components/ui/button'
  import * as Tabs from '$lib/components/ui/tabs'
  import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left'
  import ExternalLinkIcon from '@lucide/svelte/icons/external-link'
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw'
  import UploadIcon from '@lucide/svelte/icons/upload'
  import ImageIcon from '@lucide/svelte/icons/image'
  import FolderIcon from '@lucide/svelte/icons/folder-up'
  import SaveIcon from '@lucide/svelte/icons/save'
  import SendIcon from '@lucide/svelte/icons/send'
  import PlusIcon from '@lucide/svelte/icons/plus'
  import MinusIcon from '@lucide/svelte/icons/minus'
  import FileDiffIcon from '@lucide/svelte/icons/file-diff'
  import Undo2Icon from '@lucide/svelte/icons/undo-2'
  import CrosshairIcon from '@lucide/svelte/icons/crosshair'
  import LoaderIcon from '@lucide/svelte/icons/loader-circle'

  // ---- 路由参数 ----
  const getParams = useParams<{ owner: string; repo: string }>()
  const getSearch = useSearch<{
    tab: 'edit' | 'changes'
    ref?: string
    file?: string
    upload?: boolean
  }>()
  const params = $derived(getParams?.())
  const search = $derived(getSearch?.())
  const owner = $derived(params?.owner ?? '')
  const repo = $derived(params?.repo ?? '')
  const activeTab = $derived(search?.tab ?? 'edit')
  const fileRef = $derived(search?.ref)
  const selectedFile = $derived(search?.file ?? '')

  // ---- 仓库信息 ----
  let repoInfo = $state<RepoSummary | null>(null)
  const defaultBranch = $derived(repoInfo?.default_branch ?? 'main')
  const effectiveBranch = $derived(fileRef ?? defaultBranch)

  // ---- EditorVfs 实例（按 owner/repo 创建）----
  let editorVfs = $state<EditorVfs | null>(null)
  /** 文件操作处理器（vfs 就绪后创建）。 */
  let fileOps = $state<ReturnType<typeof createFileOps> | null>(null)

  // ---- 文件树状态 ----
  let tree = $state<Map<string, TreeNode>>(new Map())
  let expanded = $state<Set<string>>(new Set(['']))
  let treeLoading = $state(false)

  // ---- 编辑器状态 ----
  let fileContent = $state('')
  let fileLoading = $state(false)
  let fileError = $state<string | null>(null)
  let dirty = $state(false)
  /** 文档身份标识（切换文件时变化，触发 CodeMirror 重载）。 */
  let docId = $state('')
  /** CodeMirror 命令式 API（insertText 用）。组件挂载后填充。 */
  let cmApi = $state<CodeMirrorApi>({ insertText: () => {} })

  // ---- 变更 tab 状态 ----
  let selectedDiffPath = $state<string | null>(null)
  let diffContent = $state<{ base: string | null; current: string | null } | null>(null)
  let diffLinesResult = $state<DiffLine[]>([])
  let commitMessage = $state('')
  let committing = $state(false)

  // ---- 上传 Dialog + 图片上传状态 ----
  let uploadOpen = $state(false)
  let imageUploading = $state(false)
  /** 隐藏的文件选择 input（资产上传 + VFS 上传共用，按 action 分流）。 */
  let imageInputEl = $state<HTMLInputElement | null>(null)
  /** 当前图片选择动作：'asset' | 'vfs'。决定选完走哪条上传链路。 */
  let imageInputAction = $state<'asset' | 'vfs'>('asset')

  // ---- 右键菜单状态 ----
  let ctxMenuOpen = $state(false)
  let ctxTarget = $state<ContextTarget | null>(null)

  // ---- 重命名状态 ----
  let renamingPath = $state<string | null>(null)

  // ---- 拖拽状态 ----
  /** 当前拖拽源 path（文件树内部移动用）。 */
  let dragSourcePath = $state<string | null>(null)
  /** 文件树中悬停的目标目录（高亮）。 */
  let treeDropTarget = $state<string | null>(null)
  /** 拖到 fileTree 区域（整体遮罩：上传到 VFS）。 */
  let dragOverTree = $state(false)
  /** 拖到 code-editor 区域（整体遮罩：上传为资产）。 */
  let dragOverEditor = $state(false)

  /** 工作区初始加载（repoInfo + remote + 文件树首屏，期间显示整页骨架）。 */
  let workspaceLoading = $state(true)

  // ---- 图片资产上传默认目录（可由右键菜单「上传图片到这里」临时指定）----
  let assetUploadDir = $state<string>('')

  onMount(async () => {
    try {
      try {
        repoInfo = await getRepo(owner, repo)
      } catch {
        // 忽略，用默认分支
      }
      editorVfs = createEditorVfs(owner, repo)
      fileOps = createFileOps(editorVfs)
      await editorVfs.loadLocal()
      await editorVfs.loadRemote(effectiveBranch)
      await loadDir('')
      void recentRepos.touch(owner, repo, { branch: effectiveBranch, path: selectedFile || undefined })
    } finally {
      workspaceLoading = false
    }
  })

  // 监听分支切换：重新加载 remote 缓存 + 重建文件树。
  let firstRefLoad = true
  $effect(() => {
    const ref = fileRef
    if (firstRefLoad) {
      firstRefLoad = false
      return
    }
    if (!editorVfs) return
    void (async () => {
      treeLoading = true
      tree = new Map()
      expanded = new Set([''])
      await editorVfs!.loadRemote(ref ?? defaultBranch, true)
      await loadDir('')
      treeLoading = false
    })()
  })

  // ---- 文件树懒加载 ----
  function buildTreeNode(blobs: Array<{ path: string }>, dir: string): TreeNode {
    const prefix = dir ? `${dir}/` : ''
    const dirs = new Map<string, string>()
    const files: Array<{ name: string; path: string }> = []
    for (const blob of blobs) {
      const relPath = prefix ? blob.path.slice(prefix.length) : blob.path
      if (!relPath || relPath.startsWith('/')) continue
      const slashIdx = relPath.indexOf('/')
      if (slashIdx >= 0) {
        const dirName = relPath.slice(0, slashIdx)
        if (!dirs.has(dirName)) {
          dirs.set(dirName, dir ? `${dir}/${dirName}` : dirName)
        }
      } else {
        files.push({ name: relPath, path: blob.path })
      }
    }
    return {
      dirs: Array.from(dirs.entries())
        .map(([name, path]) => ({ name, path }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      files: files.sort((a, b) => a.name.localeCompare(b.name)),
    }
  }

  async function loadDir(dir: string): Promise<void> {
    if (!editorVfs?.remoteCache) return
    const node = buildTreeNode(editorVfs.remoteCache.blobs, dir)
    const next = new Map(tree)
    next.set(dir, node)
    tree = next
  }

  function toggleDir(dir: string): void {
    const next = new Set(expanded)
    if (next.has(dir)) {
      next.delete(dir)
    } else {
      next.add(dir)
      if (!tree.has(dir)) void loadDir(dir)
    }
    expanded = next
  }

  /** 展开到指定路径的所有上级目录（定位文件用）。 */
  function expandToPath(path: string): void {
    if (!path.includes('/')) return
    const parts = path.split('/')
    parts.pop() // 去掉文件名
    const next = new Set(expanded)
    let acc = ''
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part
      next.add(acc)
      if (!tree.has(acc)) void loadDir(acc)
    }
    expanded = next
  }

  // ---- 文件选择 + 加载内容 ----
  $effect(() => {
    void editorVfs?.remoteCommitSha
    if (selectedFile && editorVfs) {
      void loadFileContent(selectedFile)
    }
  })

  async function loadFileContent(path: string): Promise<void> {
    if (!editorVfs) return
    const kind = getFileKind(path)
    if (kind === 'image' || kind === 'video' || kind === 'audio') {
      fileContent = ''
      docId = `${owner}/${repo}/${path}`
      dirty = false
      return
    }
    fileLoading = true
    fileError = null
    try {
      const content = await editorVfs.readFile(path)
      fileContent = content
      docId = `${owner}/${repo}/${path}`
      dirty = false
    } catch (e) {
      fileError = e instanceof Error ? e.message : '加载失败'
    } finally {
      fileLoading = false
    }
  }

  function handleInput(value: string): void {
    fileContent = value
    dirty = true
  }

  async function handleSave(): Promise<void> {
    if (!editorVfs || !selectedFile || !dirty) return
    try {
      await editorVfs.writeLocal(selectedFile, fileContent)
      dirty = false
      notifySuccess('已保存到本地', '切到「变更」tab 提交到 GitHub')
    } catch (e) {
      notifyError('保存失败', e instanceof Error ? e.message : undefined)
    }
  }

  // ---- URL 导航辅助 ----
  function navigateSelect(key: 'tab' | 'file' | 'ref', value: string): void {
    const params = new URLSearchParams()
    params.set('tab', key === 'tab' ? value : activeTab)
    if (key === 'file' || selectedFile) params.set('file', key === 'file' ? value : selectedFile)
    const refValue = key === 'ref' ? value : (fileRef ?? '')
    if (refValue) params.set('ref', refValue)
    navController.navigateMain(`/app/github-editor/repo/${owner}/${repo}?${params.toString()}`)
  }

  // ---- 变更 tab：diff 计算 ----
  $effect(() => {
    if (activeTab === 'changes' && editorVfs && selectedDiffPath) {
      void loadDiff(selectedDiffPath)
    }
  })

  async function loadDiff(path: string): Promise<void> {
    if (!editorVfs) return
    try {
      diffContent = await editorVfs.fileContentDiff(path)
      diffLinesResult = diffLines(diffContent.base, diffContent.current)
    } catch {
      diffLinesResult = []
    }
  }

  async function handleCommit(): Promise<void> {
    if (!editorVfs || !commitMessage.trim()) return
    committing = true
    try {
      const sha = await editorVfs.commit(commitMessage.trim(), effectiveBranch)
      notifySuccess(`已提交（${sha.slice(0, 7)}）`)
      commitMessage = ''
      selectedDiffPath = null
      diffLinesResult = []
      await editorVfs.loadRemote(effectiveBranch, true)
      await loadDir('')
    } catch (e) {
      notifyError('提交失败', e instanceof Error ? e.message : undefined)
    } finally {
      committing = false
    }
  }

  /** discard 单个文件的本地修改（回到 remote 状态）。 */
  async function handleDiscard(path: string): Promise<void> {
    if (!editorVfs) return
    try {
      await editorVfs.revertLocal(path)
      notifySuccess('已撤销修改', path)
      if (selectedDiffPath === path) {
        selectedDiffPath = null
        diffLinesResult = []
      }
    } catch (e) {
      notifyError('撤销失败', e instanceof Error ? e.message : undefined)
    }
  }

  /** 定位到 fileTree：切到 edit tab + 选文件 + 展开目录。 */
  function handleLocateInTree(path: string): void {
    navigateSelect('tab', 'edit')
    navigateSelect('file', path)
    expandToPath(path)
  }

  async function handleRefresh(): Promise<void> {
    if (!editorVfs) return
    await editorVfs.loadRemote(effectiveBranch, true)
    await loadDir('')
  }

  function openUpload(): void {
    uploadOpen = true
  }

  // ---- 图片上传：工具栏按钮 ----
  function triggerImageUpload(action: 'asset' | 'vfs', dir = ''): void {
    imageInputAction = action
    assetUploadDir = dir
    imageInputEl?.click()
  }

  async function handleImageInputSelect(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement
    if (!input.files || input.files.length === 0) return
    const file = input.files[0]
    input.value = '' // 重置，允许下次选同名文件
    await doImageUpload(file, imageInputAction, assetUploadDir)
  }

  /** 执行图片上传（资产 or VFS）+ 插入 markdown 链接。 */
  async function doImageUpload(file: File, action: 'asset' | 'vfs', dir: string): Promise<void> {
    if (!editorVfs) return
    imageUploading = true
    try {
      if (action === 'asset') {
        const url = await uploadImageAsAsset(file, { owner, repo, branch: effectiveBranch, dirPath: dir })
        cmApi.insertText(buildImageMarkdown(url, file.name))
        notifySuccess('图片已插入', '已上传为资产并插入链接')
      } else {
        const { path, rawUrl } = await uploadImageToVfs(file, {
          vfs: editorVfs,
          dirPath: dir,
          owner,
          repo,
          branch: effectiveBranch,
        })
        cmApi.insertText(buildImageMarkdown(rawUrl, file.name))
        notifySuccess('图片已加入变更', `${path}（切到「变更」tab 一并提交）`)
        // 刷新文件树让新文件可见
        if (path.includes('/')) expandToPath(path)
      }
    } catch (e) {
      notifyError('图片上传失败', e instanceof Error ? e.message : undefined)
    } finally {
      imageUploading = false
    }
  }

  // ---- 编辑器区域：粘贴 + 拖拽上传（资产方案）----
  function handleEditorPaste(e: ClipboardEvent): void {
    const file = pickFirstImage(e)
    if (!file) return
    e.preventDefault()
    void doImageUpload(file, 'asset', assetUploadDir)
  }

  function handleEditorDragOver(e: DragEvent): void {
    if (!hasImageFiles(e)) return
    e.preventDefault()
    dragOverEditor = true
  }

  function handleEditorDragLeave(e: DragEvent): void {
    if (e.currentTarget === e.target) dragOverEditor = false
  }

  function handleEditorDrop(e: DragEvent): void {
    if (!hasImageFiles(e)) return
    e.preventDefault()
    dragOverEditor = false
    const file = pickFirstImage(e)
    if (file) void doImageUpload(file, 'asset', assetUploadDir)
  }

  // ---- 文件树区域：拖拽上传（VFS 方案）+ 整体遮罩 ----
  function handleTreeAreaDragOver(e: DragEvent): void {
    if (!hasImageFiles(e)) return
    e.preventDefault()
    dragOverTree = true
  }

  function handleTreeAreaDragLeave(e: DragEvent): void {
    if (e.currentTarget === e.target) dragOverTree = false
  }

  function handleTreeAreaDrop(e: DragEvent): void {
    if (!hasImageFiles(e)) return
    e.preventDefault()
    dragOverTree = false
    const file = pickFirstImage(e)
    if (file) void doImageUpload(file, 'vfs', '')
  }

  // ---- FileTree 事件回调 ----
  function handleTreeDragStart(path: string, _isDir: boolean, e: DragEvent): void {
    dragSourcePath = path
    e.dataTransfer?.setData('text/plain', path)
  }

  function handleTreeDragOverDir(_dir: string, e: DragEvent): void {
    // 文件树内部移动 OR 外部图片上传都允许 drop
    e.preventDefault()
    if (dragSourcePath) {
      treeDropTarget = _dir
    }
  }

  function handleTreeDragLeaveDir(dir: string): void {
    if (treeDropTarget === dir) treeDropTarget = null
  }

  async function handleTreeDropOnDir(dir: string, e: DragEvent): Promise<void> {
    e.preventDefault()
    e.stopPropagation()
    treeDropTarget = null
    // 优先处理图片上传（外部拖入）
    if (hasImageFiles(e)) {
      const file = pickFirstImage(e)
      if (file) {
        void doImageUpload(file, 'vfs', dir)
      }
      return
    }
    // 文件树内部移动
    if (dragSourcePath && fileOps) {
      await fileOps.moveByDrop(dragSourcePath, dir)
      dragSourcePath = null
    }
  }

  // ---- 右键菜单 ----
  function handleTreeContextMenu(path: string, isDir: boolean, e: MouseEvent): void {
    e.preventDefault()
    e.stopPropagation()
    ctxTarget = { path, isDir }
    ctxMenuOpen = true
  }

  function ctxRename(): void {
    if (ctxTarget) renamingPath = ctxTarget.path
  }

  async function ctxCopyPath(): Promise<void> {
    if (!ctxTarget) return
    try {
      await copyText(ctxTarget.path)
      notifySuccess('已复制路径', ctxTarget.path)
    } catch (e) {
      notifyError('复制失败', e instanceof Error ? e.message : undefined)
    }
  }

  function ctxCopy(): void {
    if (ctxTarget && fileOps) fileOps.copy(ctxTarget.path)
  }

  function ctxCut(): void {
    if (ctxTarget && fileOps) fileOps.cut(ctxTarget.path)
  }

  async function ctxPaste(): Promise<void> {
    if (ctxTarget?.isDir && fileOps) {
      await fileOps.paste(ctxTarget.path)
    }
  }

  async function ctxDelete(): Promise<void> {
    if (ctxTarget && fileOps) {
      await fileOps.remove(ctxTarget.path)
      // 删除当前选中文件时清空编辑器
      if (selectedFile === ctxTarget.path) {
        navigateSelect('file', '')
      }
    }
  }

  function ctxUploadImageHere(): void {
    if (ctxTarget?.isDir) {
      triggerImageUpload('vfs', ctxTarget.path)
    }
  }

  // ---- 重命名提交/取消 ----
  async function handleRenameCommit(oldPath: string, newPath: string): Promise<void> {
    renamingPath = null
    if (fileOps) {
      const ok = await fileOps.rename(oldPath, newPath)
      // 重命名当前选中文件时跟随更新 URL
      if (ok && selectedFile === oldPath) {
        navigateSelect('file', newPath)
      }
    }
  }

  function handleRenameCancel(): void {
    renamingPath = null
  }

  // ---- 变更类型 → 图标 + 颜色 ----
  function diffKindMeta(kind: FileDiff['kind']): { icon: typeof PlusIcon; class: string; label: string } {
    switch (kind) {
      case 'add':
        return { icon: PlusIcon, class: 'text-emerald-500', label: '新增' }
      case 'mod':
        return { icon: FileDiffIcon, class: 'text-amber-500', label: '修改' }
      case 'del':
        return { icon: MinusIcon, class: 'text-red-500', label: '删除' }
    }
  }
</script>

<div class="flex h-full flex-col">
  {#if workspaceLoading}
    <!-- 工作区初始加载骨架 -->
    <div class="border-border flex items-center gap-2 border-b px-3 py-1.5">
      <Skeleton class="h-4 w-32" />
      <Skeleton class="h-3 w-16" />
      <div class="ml-auto flex gap-2">
        <Skeleton class="h-7 w-32" />
      </div>
    </div>
    <div class="grid h-full min-w-0 md:grid-cols-[minmax(200px,280px)_1fr]">
      <div class="border-border max-md:hidden border-r p-2">
        {#each Array(8) as _}<Skeleton class="mb-2 h-5" />{/each}
      </div>
      <div class="p-6">
        <Skeleton class="mb-3 h-4 w-3/4" />
        <Skeleton class="mb-2 h-3 w-full" />
        <Skeleton class="mb-2 h-3 w-5/6" />
        <Skeleton class="mb-2 h-3 w-full" />
        <Skeleton class="mb-2 h-3 w-4/5" />
        <Skeleton class="h-3 w-3/4" />
      </div>
    </div>
  {:else}
  <!-- 顶部工具栏 -->
  <div class="flex items-center gap-2 border-b border-border px-3 py-1.5">
    <button
      type="button"
      onclick={() => navController.navigateMain('/app/github-editor')}
      class="text-muted-foreground hover:bg-accent hover:text-foreground inline-flex size-7 items-center justify-center rounded transition-colors"
      aria-label="返回首页"
      title="返回首页"
    >
      <ArrowLeftIcon class="size-4" />
    </button>
    <span class="font-mono text-sm font-semibold">{owner}/{repo}</span>
    <RepoRefSelector
      {owner}
      {repo}
      currentRef={fileRef ?? ''}
      defaultBranch={repoInfo?.default_branch ?? 'main'}
      onSelect={(ref) => {
        if (ref === (repoInfo?.default_branch ?? 'main')) {
          navigateSelect('ref', '')
        } else {
          navigateSelect('ref', ref)
        }
      }}
    />
    {#if editorVfs && editorVfs.dirtyCount > 0}
      <span class="bg-amber-500/15 text-amber-700 dark:text-amber-400 rounded-full px-2 py-0.5 text-[10px] font-medium">
        {editorVfs.dirtyCount} 个变更
      </span>
    {/if}
    {#if imageUploading}
      <span class="text-muted-foreground flex items-center gap-1 text-xs">
        <LoaderIcon class="size-3.5 animate-spin" />
        图片上传中…
      </span>
    {/if}

    <div class="ml-auto flex items-center gap-1">
      <button
        type="button"
        onclick={() => {
          const params = new URLSearchParams()
          if (selectedFile) params.set('file', selectedFile)
          if (fileRef) params.set('ref', fileRef)
          const qs = params.toString()
          navController.navigateMain(`/app/github/repo/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${qs ? `?${qs}` : ''}`)
        }}
        class="text-muted-foreground hover:bg-accent hover:text-foreground inline-flex size-7 items-center justify-center rounded transition-colors"
        aria-label="在 GithubApp 中查看"
        title="在 GithubApp 中查看"
      >
        <ExternalLinkIcon class="size-3.5" />
      </button>
      <Tabs.Root value={activeTab} onValueChange={(v) => navigateSelect('tab', v)}>
        <Tabs.List>
          <Tabs.Trigger value="edit">编辑</Tabs.Trigger>
          <Tabs.Trigger value="changes">
            变更
            {#if editorVfs && editorVfs.dirtyCount > 0}
              <span class="ml-1 text-[10px]">({editorVfs.dirtyCount})</span>
            {/if}
          </Tabs.Trigger>
        </Tabs.List>
      </Tabs.Root>
      <div class="mx-1 h-5 w-px bg-border"></div>
      <!-- 图片上传：资产（即时 URL 插入） -->
      <button
        type="button"
        onclick={() => triggerImageUpload('asset')}
        disabled={imageUploading}
        class="text-muted-foreground hover:bg-accent hover:text-foreground inline-flex size-7 items-center justify-center rounded transition-colors disabled:opacity-50"
        aria-label="插入图片（资产）"
        title="插入图片（资产：即时上传并插入链接）"
      >
        <ImageIcon class="size-3.5" />
      </button>
      <!-- 图片上传：VFS（随 commit 提交） -->
      <button
        type="button"
        onclick={() => triggerImageUpload('vfs')}
        disabled={imageUploading}
        class="text-muted-foreground hover:bg-accent hover:text-foreground inline-flex size-7 items-center justify-center rounded transition-colors disabled:opacity-50"
        aria-label="上传图片到仓库"
        title="上传图片到仓库（随文本一起提交）"
      >
        <FolderIcon class="size-3.5" />
      </button>
      <button
        type="button"
        onclick={handleRefresh}
        class="text-muted-foreground hover:bg-accent hover:text-foreground inline-flex size-7 items-center justify-center rounded transition-colors"
        aria-label="刷新"
        title="刷新远程缓存"
      >
        <RefreshCwIcon class="size-3.5 {editorVfs?.remoteLoading ? 'animate-spin' : ''}" />
      </button>
      <button
        type="button"
        onclick={openUpload}
        class="text-muted-foreground hover:bg-accent hover:text-foreground inline-flex size-7 items-center justify-center rounded transition-colors"
        aria-label="上传文件"
        title="上传文件/文件夹"
      >
        <UploadIcon class="size-3.5" />
      </button>
    </div>
  </div>

  <!-- 隐藏的图片选择 input（资产 + VFS 共用） -->
  <input
    bind:this={imageInputEl}
    type="file"
    accept="image/*"
    class="hidden"
    onchange={handleImageInputSelect}
  />

  <!-- Tab 内容区 -->
  <div class="min-h-0 flex-1">
    {#if activeTab === 'edit'}
      <!-- 编辑 tab：左文件树 + 右编辑器 -->
      <div
        class="relative grid h-full min-w-0 md:grid-cols-[minmax(200px,280px)_1fr]"
        ondragover={handleTreeAreaDragOver}
        ondragleave={handleTreeAreaDragLeave}
        ondrop={handleTreeAreaDrop}
        role="region"
        aria-label="编辑工作区（拖拽图片到左侧上传到仓库，到右侧插入为资产）"
      >
        <!-- 左：文件树（拖拽到整个左栏 = 上传到 VFS 根目录） -->
        <div class="border-border max-md:hidden relative min-w-0 border-r">
          <div class="min-h-0 overflow-auto">
            {#if treeLoading}
              {#each Array(5) as _}<Skeleton class="mb-2 h-5" />{/each}
            {:else}
              <FileTree
                {tree}
                {expanded}
                {selectedFile}
                {renamingPath}
                dropTarget={treeDropTarget ? { path: treeDropTarget } : null}
                onSelect={(p) => navigateSelect('file', p)}
                onToggleDir={toggleDir}
                onDragStart={handleTreeDragStart}
                onDragOverDir={handleTreeDragOverDir}
                onDragLeaveDir={handleTreeDragLeaveDir}
                onDropOnDir={handleTreeDropOnDir}
                onContextMenu={handleTreeContextMenu}
                onRenameCommit={handleRenameCommit}
                onRenameCancel={handleRenameCancel}
              />
            {/if}
          </div>
          <!-- 拖拽到 fileTree 区域的整体遮罩 -->
          {#if dragOverTree}
            <div class="bg-primary/10 ring-ring absolute inset-0 z-10 flex items-center justify-center rounded ring-2 ring-inset">
              <div class="bg-background/80 flex flex-col items-center gap-1 rounded-lg p-4 text-center backdrop-blur">
                <FolderIcon class="text-primary size-6" />
                <p class="text-sm font-medium">松开上传到仓库（VFS）</p>
                <p class="text-muted-foreground text-xs">图片将随下次提交一并 commit</p>
              </div>
            </div>
          {/if}
        </div>

        <!-- 右：编辑器（拖拽到编辑器 = 上传为资产） -->
        <div class="relative min-w-0">
          {#if !selectedFile}
            <div class="text-muted-foreground flex h-full items-center justify-center text-sm">
              选择左侧文件开始编辑
            </div>
          {:else if fileLoading}
            <div class="space-y-2 p-6">
              <Skeleton class="h-4 w-3/4" />
              <Skeleton class="h-4 w-full" />
              <Skeleton class="h-4 w-5/6" />
            </div>
          {:else if fileError}
            <div class="text-destructive p-6">
              <p class="font-medium">加载失败</p>
              <p class="text-muted-foreground mt-1 text-sm">{fileError}</p>
            </div>
          {:else}
            {@const kind = getFileKind(selectedFile)}
            {#if kind === 'markdown' || kind === 'text'}
              <div class="flex h-full flex-col">
                <div class="border-border flex items-center gap-2 border-b px-3 py-1">
                  <span class="text-muted-foreground truncate font-mono text-xs">{selectedFile}</span>
                  {#if dirty}
                    <span class="bg-amber-500/15 text-amber-600 rounded px-1 text-[10px]">未保存</span>
                  {/if}
                  <Button size="sm" variant="ghost" class="ml-auto" onclick={handleSave} disabled={!dirty}>
                    <SaveIcon class="size-3.5" />
                    <span class="hidden sm:inline">保存</span>
                  </Button>
                </div>
                <div
                  class="relative min-h-0 flex-1"
                  onpaste={handleEditorPaste}
                  ondragover={handleEditorDragOver}
                  ondragleave={handleEditorDragLeave}
                  ondrop={handleEditorDrop}
                  role="region"
                  aria-label="代码编辑器"
                >
                  <CodeMirror
                    doc={fileContent}
                    {docId}
                    filePath={selectedFile}
                    onInput={handleInput}
                    onSave={handleSave}
                    api={cmApi}
                  />
                  {#if dragOverEditor}
                    <div class="bg-primary/10 ring-ring absolute inset-0 z-10 flex items-center justify-center rounded ring-2 ring-inset pointer-events-none">
                      <div class="bg-background/80 flex flex-col items-center gap-1 rounded-lg p-4 text-center backdrop-blur">
                        <ImageIcon class="text-primary size-6" />
                        <p class="text-sm font-medium">松开上传为图片资产</p>
                        <p class="text-muted-foreground text-xs">即时上传并插入 markdown 链接</p>
                      </div>
                    </div>
                  {/if}
                </div>
              </div>
            {:else if kind === 'image'}
              <div class="flex h-full items-center justify-center p-6">
                <img src={`https://raw.githubusercontent.com/${owner}/${repo}/${effectiveBranch}/${selectedFile}`} alt={selectedFile} class="max-h-full max-w-full" />
              </div>
            {:else}
              <div class="text-muted-foreground flex h-full items-center justify-center text-sm">
                此文件类型不支持编辑
              </div>
            {/if}
          {/if}
        </div>
      </div>
    {:else if activeTab === 'changes'}
      <!-- 变更 tab：左 dirty 列表（带操作）+ 右 diff -->
      <div class="grid h-full min-w-0 md:grid-cols-[minmax(200px,300px)_1fr]">
        <div class="border-border max-md:hidden min-w-0 overflow-auto border-r p-2">
          {#if editorVfs && editorVfs.diff.length === 0}
            <p class="text-muted-foreground py-8 text-center text-sm">工作区干净</p>
          {:else if editorVfs}
            {#each editorVfs.diff as d (d.path)}
              {@const meta = diffKindMeta(d.kind)}
              <div class="group hover:bg-accent/50 relative flex items-center gap-1.5 rounded px-1.5 py-1.5 text-xs {selectedDiffPath === d.path ? 'bg-accent' : ''}">
                <button
                  type="button"
                  onclick={() => (selectedDiffPath = d.path)}
                  class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                >
                  <meta.icon class="size-3.5 shrink-0 {meta.class}" />
                  <span class="truncate font-mono">{d.path}</span>
                  <span class="text-muted-foreground shrink-0 text-[10px]">{meta.label}</span>
                </button>
                <!-- hover 操作（定位 + discard） -->
                <div class="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    onclick={() => handleLocateInTree(d.path)}
                    class="text-muted-foreground hover:text-foreground rounded p-0.5"
                    aria-label="在文件树定位"
                    title="在文件树定位"
                  >
                    <CrosshairIcon class="size-3" />
                  </button>
                  <button
                    type="button"
                    onclick={() => handleDiscard(d.path)}
                    class="text-muted-foreground hover:text-destructive rounded p-0.5"
                    aria-label="撤销此文件修改"
                    title="撤销此文件修改"
                  >
                    <Undo2Icon class="size-3" />
                  </button>
                </div>
              </div>
            {/each}
          {/if}
        </div>

        <div class="flex min-w-0 flex-col">
          {#if !selectedDiffPath}
            <div class="text-muted-foreground flex flex-1 items-center justify-center text-sm">
              {#if editorVfs && editorVfs.diff.length > 0}
                选择左侧文件查看 diff
              {:else}
                没有未提交的变更
              {/if}
            </div>
          {:else}
            <div class="min-h-0 flex-1 overflow-auto">
              <div class="border-border border-b px-3 py-1.5">
                <span class="font-mono text-xs">{selectedDiffPath}</span>
              </div>
              <pre class="text-xs leading-relaxed font-mono"><code>{#each diffLinesResult as line, i}<span class="block {line.type === 'add' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : line.type === 'del' ? 'bg-red-500/10 text-red-700 dark:text-red-400' : ''}"><span class="text-muted-foreground/40 inline-block w-8 select-none pr-2 text-right">{i + 1}</span>{line.text}</span>{/each}</code></pre>
            </div>
          {/if}

          <div class="border-border border-t p-3">
            <textarea
              bind:value={commitMessage}
              placeholder="提交信息…"
              rows="2"
              class="border-border bg-background focus:border-ring mb-2 w-full resize-none rounded-lg border px-3 py-2 text-sm outline-none transition-colors"
            ></textarea>
            <div class="flex items-center gap-2">
              {#if editorVfs && editorVfs.dirtyCount > 0}
                <span class="text-muted-foreground text-xs">{editorVfs.dirtyCount} 个文件将提交</span>
              {/if}
              <Button
                size="sm"
                class="ml-auto"
                onclick={handleCommit}
                disabled={!commitMessage.trim() || committing || !editorVfs?.dirtyCount}
              >
                <SendIcon class="size-3.5" />
                {committing ? '提交中…' : '提交'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    {/if}
  </div>
  {/if}
</div>

{#if uploadOpen && editorVfs}
  <UploadDialog
    {owner}
    {repo}
    branch={effectiveBranch}
    editorVfs={editorVfs}
    onClose={() => (uploadOpen = false)}
  />
{/if}

<!-- 文件树右键菜单（受控） -->
<FileTreeContextMenu
  bind:open={ctxMenuOpen}
  target={ctxTarget}
  clipboardEntry={fileClipboard.entry}
  onRename={ctxRename}
  onCopyPath={ctxCopyPath}
  onCopy={ctxCopy}
  onCut={ctxCut}
  onPaste={ctxPaste}
  onDelete={ctxDelete}
  onUploadImageHere={ctxUploadImageHere}
/>
