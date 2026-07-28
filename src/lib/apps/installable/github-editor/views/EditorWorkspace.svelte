<!--
	EditorWorkspace：GithubEditor 的编辑工作区（双 tab）。

	2026-07-28：VSCode 式仓库编辑器。
	- 顶部：owner/repo + RepoRefSelector（分支切换）+ 刷新 + 上传 + dirty 计数
	- 编辑 tab：左文件树（懒加载）+ 右 CodeMirror（按文件类型选语言）
	- 变更 tab：左 dirty 列表 + 右行级 diff + commit message + 提交

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
  import { getRepo, type RepoSummary } from '$lib/apps/installable/github/repo-api'
  import { recentRepos } from '../recent-repos.svelte'
  import { notifySuccess, notifyError } from '$lib/apps/builtin/notifications/service.svelte'
  import CodeMirror from '$lib/editor/CodeMirror.svelte'
  import MarkdownViewer from '$lib/markdown/MarkdownViewer.svelte'
  import UploadDialog from './UploadDialog.svelte'
  import { getFileKind, canPreview } from '$lib/github/file-kind'
  import { diffLines, type DiffLine } from '$lib/utils/diff'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import { Button } from '$lib/components/ui/button'
  import * as Tabs from '$lib/components/ui/tabs'
  import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left'
  import ExternalLinkIcon from '@lucide/svelte/icons/external-link'
  import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw'
  import UploadIcon from '@lucide/svelte/icons/upload'
  import FolderIcon from '@lucide/svelte/icons/folder'
  import FileTextIcon from '@lucide/svelte/icons/file-text'
  import ChevronRightIcon from '@lucide/svelte/icons/chevron-right'
  import ChevronDownIcon from '@lucide/svelte/icons/chevron-down'
  import SaveIcon from '@lucide/svelte/icons/save'
  import SendIcon from '@lucide/svelte/icons/send'
  import PlusIcon from '@lucide/svelte/icons/plus'
  import MinusIcon from '@lucide/svelte/icons/minus'
  import FileDiffIcon from '@lucide/svelte/icons/file-diff'
  import Trash2Icon from '@lucide/svelte/icons/trash-2'

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

  // ---- 文件树状态 ----
  interface TreeNode {
    dirs: Array<{ name: string; path: string }>
    files: Array<{ name: string; path: string }>
  }
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

  // ---- 变更 tab 状态 ----
  let selectedDiffPath = $state<string | null>(null)
  let diffContent = $state<{ base: string | null; current: string | null } | null>(null)
  let diffLinesResult = $state<DiffLine[]>([])
  let commitMessage = $state('')
  let committing = $state(false)

  // ---- 上传 Dialog ----
  let uploadOpen = $state(false)
  /** 工作区初始加载（repoInfo + remote + 文件树首屏，期间显示整页骨架）。 */
  let workspaceLoading = $state(true)

  onMount(async () => {
    try {
      // 加载仓库信息
      try {
        repoInfo = await getRepo(owner, repo)
      } catch {
        // 忽略，用默认分支
      }
      // 创建 EditorVfs + 加载
      editorVfs = createEditorVfs(owner, repo)
      await editorVfs.loadLocal()
      await editorVfs.loadRemote(effectiveBranch)
      // 加载文件树根目录
      await loadDir('')
      // 记录最近打开
      void recentRepos.touch(owner, repo, { branch: effectiveBranch, path: selectedFile || undefined })
    } finally {
      workspaceLoading = false
    }
  })

  // ---- 文件树懒加载（从 remoteCache.blobs 推导）----
  function buildTreeNode(blobs: Array<{ path: string }>, dir: string): TreeNode {
    const prefix = dir ? `${dir}/` : ''
    const dirs = new Map<string, string>()
    const files: Array<{ name: string; path: string }> = []
    for (const blob of blobs) {
      // 只处理当前层级（path 去掉前缀后不含 /）
      const relPath = prefix ? blob.path.slice(prefix.length) : blob.path
      if (!relPath || relPath.startsWith('/')) continue
      const slashIdx = relPath.indexOf('/')
      if (slashIdx >= 0) {
        // 子目录
        const dirName = relPath.slice(0, slashIdx)
        if (!dirs.has(dirName)) {
          dirs.set(dirName, dir ? `${dir}/${dirName}` : dirName)
        }
      } else {
        // 文件
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

  // ---- 文件选择 + 加载内容 ----
  $effect(() => {
    if (selectedFile && editorVfs) {
      void loadFileContent(selectedFile)
    }
  })

  async function loadFileContent(path: string): Promise<void> {
    if (!editorVfs) return
    const kind = getFileKind(path)
    // 媒体文件不加载文本
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
    if (key === 'ref' || fileRef) params.set('ref', key === 'ref' ? value : fileRef ?? '')
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
      // 刷新 remote（提交后 HEAD 变了）
      await editorVfs.loadRemote(effectiveBranch, true)
    } catch (e) {
      notifyError('提交失败', e instanceof Error ? e.message : undefined)
    } finally {
      committing = false
    }
  }

  async function handleRefresh(): Promise<void> {
    if (!editorVfs) return
    await editorVfs.loadRemote(effectiveBranch, true)
    await loadDir('')
  }

  function openUpload(): void {
    uploadOpen = true
  }

  /** 变更类型 → 图标 + 颜色。 */
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
    <!-- 工作区初始加载骨架（repoInfo + remote + 文件树首屏） -->
    <div class="border-border flex items-center gap-2 border-b px-3 py-1.5">
      <Skeleton class="h-4 w-32" />
      <Skeleton class="h-3 w-16" />
      <div class="ml-auto flex gap-2">
        <Skeleton class="h-7 w-32" />
      </div>
    </div>
    <div class="grid h-full min-w-0 md:grid-cols-[minmax(200px,280px)_1fr]">
      <!-- 左：文件树骨架 -->
      <div class="border-border max-md:hidden border-r p-2">
        {#each Array(8) as _}<Skeleton class="mb-2 h-5" />{/each}
      </div>
      <!-- 右：编辑器骨架 -->
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
    {#if repoInfo?.default_branch}
      <span class="text-muted-foreground text-xs">@ {fileRef ?? repoInfo.default_branch}</span>
    {/if}
    {#if editorVfs && editorVfs.dirtyCount > 0}
      <span class="bg-amber-500/15 text-amber-700 dark:text-amber-400 rounded-full px-2 py-0.5 text-[10px] font-medium">
        {editorVfs.dirtyCount} 个变更
      </span>
    {/if}

    <div class="ml-auto flex items-center gap-1">
      <!-- 在 GithubApp 中查看此仓库（跳详情页浏览） -->
      <button
        type="button"
        onclick={() => navController.navigateMain(`/app/github/repo/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`)}
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
        aria-label="上传"
        title="上传文件/文件夹"
      >
        <UploadIcon class="size-3.5" />
      </button>
    </div>
  </div>

  <!-- Tab 内容区 -->
  <div class="min-h-0 flex-1">
    {#if activeTab === 'edit'}
      <!-- 编辑 tab：左文件树 + 右编辑器 -->
      <div class="grid h-full min-w-0 md:grid-cols-[minmax(200px,280px)_1fr]">
        <!-- 左：文件树 -->
        <div class="border-border max-md:hidden min-w-0 border-r">
          <div class="min-h-0 overflow-auto p-2">
            {#if treeLoading}
              {#each Array(5) as _}<Skeleton class="mb-2 h-5" />{/each}
            {:else}
              <!-- TODO: 递归文件树渲染（简化版：先渲染根目录 + 已展开的子目录） -->
              {#each tree.get('')?.dirs ?? [] as d}
                <button
                  type="button"
                  onclick={() => toggleDir(d.path)}
                  class="hover:bg-accent flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-xs transition-colors"
                >
                  {#if expanded.has(d.path)}
                    <ChevronDownIcon class="size-3 shrink-0" />
                  {:else}
                    <ChevronRightIcon class="size-3 shrink-0" />
                  {/if}
                  <FolderIcon class="size-3.5 shrink-0 text-amber-500" />
                  <span class="truncate">{d.name}</span>
                </button>
                {#if expanded.has(d.path) && tree.has(d.path)}
                  {#each tree.get(d.path)?.files ?? [] as f}
                    <button
                      type="button"
                      onclick={() => navigateSelect('file', f.path)}
                      class="hover:bg-accent flex w-full items-center gap-1 rounded py-1 pl-8 pr-1.5 text-left text-xs transition-colors {selectedFile === f.path ? 'bg-accent' : ''}"
                    >
                      <FileTextIcon class="size-3.5 shrink-0 text-muted-foreground" />
                      <span class="truncate">{f.name}</span>
                    </button>
                  {/each}
                {/if}
              {/each}
              {#each tree.get('')?.files ?? [] as f}
                <button
                  type="button"
                  onclick={() => navigateSelect('file', f.path)}
                  class="hover:bg-accent flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-xs transition-colors {selectedFile === f.path ? 'bg-accent' : ''}"
                >
                  <FileTextIcon class="size-3.5 shrink-0 text-muted-foreground" />
                  <span class="truncate">{f.name}</span>
                </button>
              {/each}
            {/if}
          </div>
        </div>

        <!-- 右：编辑器 -->
        <div class="min-w-0">
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
                <!-- 文件路径 + 保存按钮 -->
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
                <!-- CodeMirror 编辑器 -->
                <div class="min-h-0 flex-1">
                  <CodeMirror
                    doc={fileContent}
                    {docId}
                    filePath={selectedFile}
                    onInput={handleInput}
                    onSave={handleSave}
                  />
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
      <!-- 变更 tab：左 dirty 列表 + 右 diff -->
      <div class="grid h-full min-w-0 md:grid-cols-[minmax(200px,300px)_1fr]">
        <!-- 左：dirty 文件列表 -->
        <div class="border-border max-md:hidden min-w-0 overflow-auto border-r p-2">
          {#if editorVfs && editorVfs.diff.length === 0}
            <p class="text-muted-foreground py-8 text-center text-sm">工作区干净</p>
          {:else if editorVfs}
            {#each editorVfs.diff as d (d.path)}
              {@const meta = diffKindMeta(d.kind)}
              <button
                type="button"
                onclick={() => (selectedDiffPath = d.path)}
                class="hover:bg-accent flex w-full items-center gap-1.5 rounded px-1.5 py-1.5 text-left text-xs transition-colors {selectedDiffPath === d.path ? 'bg-accent' : ''}"
              >
                <meta.icon class="size-3.5 shrink-0 {meta.class}" />
                <span class="truncate font-mono">{d.path}</span>
                <span class="text-muted-foreground ml-auto shrink-0 text-[10px]">{meta.label}</span>
              </button>
            {/each}
          {/if}
        </div>

        <!-- 右：diff 视图 + commit -->
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
            <!-- diff 视图 -->
            <div class="min-h-0 flex-1 overflow-auto">
              <div class="border-border border-b px-3 py-1.5">
                <span class="font-mono text-xs">{selectedDiffPath}</span>
              </div>
              <pre class="text-xs leading-relaxed font-mono"><code>{#each diffLinesResult as line, i}<span class="block {line.type === 'add' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : line.type === 'del' ? 'bg-red-500/10 text-red-700 dark:text-red-400' : ''}"><span class="text-muted-foreground/40 inline-block w-8 select-none pr-2 text-right">{i + 1}</span>{line.text}</span>{/each}</code></pre>
            </div>
          {/if}

          <!-- commit 区域 -->
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
