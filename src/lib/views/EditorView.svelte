<!--
	EditorView：编辑器主页。
	- 从 search query 解析编辑目标：
	  - content：/app/editor?collection=articles&stem=xxx（内容管线，frontmatter + 发表）
	  - raw：/app/github-edit?owner=X&repo=Y&file=Z（GithubApp 任意文件，纯文本，仅主仓库可写）
	- 加载文章内容（VFS 三层读取：本地修改 > 远程缓存 > 在线拉取）
	- 三视图：编辑 / 分屏 / 预览
	- 自动保存到 VFS（dirty 标记），debounce 1s
	- 顶部工具栏：视图切换、元数据编辑、保存、发表
-->
<script lang="ts">
  import CodeMirror from '$lib/editor/CodeMirror.svelte'
  import MetadataEditor from '$lib/editor/MetadataEditor.svelte'
  import MarkdownViewer from '$lib/markdown/MarkdownViewer.svelte'
  import { untrack } from 'svelte'
  import { vfsStore } from '$lib/vfs/vfs.svelte'
  import { contentQuery } from '$lib/content-pipeline/query.svelte'
  import { navStore } from '$lib/nav/nav.svelte'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { gaubeeos } from '$lib/os/services'
  import { handlePublishError } from '$lib/os/services/publish-helper'
  import { notifySuccess } from '$lib/apps/builtin/notifications/service.svelte'
  import { useSearch } from '$lib/router'
  import { targetById } from '$lib/router'
  import { parseMarkdown, serializeMarkdown, type ArticleMetadata } from '$lib/data/frontmatter'
  import { getFileWithSha, updateFileContent } from '$lib/github/client'
  import { useRepoEditPermission } from '$lib/apps/views/github/use-repo-edit-permission.svelte'
  import { Button } from '$lib/components/ui/button'
  import * as Dialog from '$lib/components/ui/dialog'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import { toast } from 'svelte-sonner'
  import EyeIcon from '@lucide/svelte/icons/eye'
  import ColumnsIcon from '@lucide/svelte/icons/columns-2'
  import PencilIcon from '@lucide/svelte/icons/pencil'
  import TagsIcon from '@lucide/svelte/icons/tags'
  import SaveIcon from '@lucide/svelte/icons/save'
  import SendIcon from '@lucide/svelte/icons/send'
  import XIcon from '@lucide/svelte/icons/x'
  import LockIcon from '@lucide/svelte/icons/lock'

  type View = 'edit' | 'split' | 'preview'

  const navState = $derived(navStore.current)
  // EditorView 同时作为 writer.editor 与 writer.github-edit 两个 activity 的组件，
  // 二者都通过 search query 传参。useSearch 拿到当前 activity 的 parsed search。
  const getSearch = useSearch()
  let view = $state<View>('edit')
  let metadataOpen = $state(false)
  let loading = $state(false)
  let error = $state<string | null>(null)
  /** 当前编辑的文件 VFS 路径（如 src/content/articles/0057.tc39-signals.md）。 */
  let currentPath = $state<string | null>(null)
  let metadata = $state<ArticleMetadata>({ date: new Date(), tags: [] })
  let body = $state('')
  /** 文档身份标识（切换文章时变化，触发 CodeMirror 重载）。 */
  let docId = $state('')
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  /** 竞态防护：每次 loadPost 递增，回调比对 seq 决定是否应用结果。 */
  let loadSeq = 0
  /** 是否有未保存修改（用于提示）。 */
  let dirty = $state(false)
  /** 是否正在发表（提交到 GitHub）。 */
  let publishing = $state(false)

  /**
   * 从 search query 解析编辑目标，支持两种模式（按当前 activity 的 pathname 区分）：
   * - content：/app/editor?collection=articles&stem=xxx（内容管线，frontmatter + 发表）
   * - raw：/app/github-edit?owner=X&repo=Y&file=Z&ref?（GithubApp 任意文件，基于 GitHub
   *   API 真实权限判定可写性，不经 vfsStore，直接 Contents API 读写）
   */
  const target = $derived.by(() => {
    const path = navState.mainLocation.pathname
    const search = getSearch?.()
    if (!search) return null
    if (path === '/app/github-edit') {
      const { owner, repo, file, ref } = search as {
        owner: string
        repo: string
        file: string
        ref?: string
      }
      return {
        kind: 'raw' as const,
        owner,
        repo,
        filePath: file,
        ref: ref ?? '',
      }
    }
    if (path === '/app/editor') {
      const { collection, stem } = search as { collection: 'articles' | 'events' | 'draft'; stem: string }
      return { kind: 'content' as const, collection, stem }
    }
    return null
  })

  /** raw 模式：当前文件的 GitHub sha（乐观锁用，更新已有文件必填）。
   *  每次 loadPost 加载时填充，保存成功后更新为新 sha。 */
  let rawSha = $state<string | null>(null)
  /** raw 模式：是否正在保存到 GitHub（保存按钮 loading 态）。 */
  let rawSaving = $state(false)

  /** raw 模式权限判定 hook（owner/repo 变化时自动重查 getRepo + getBranch）。
   *  三层判定：push 权限 + ref 一致性 + 分支保护。
   *  传 getter 保证响应性（target 变化时 hook 内部 $derived 自动重算）。 */
  const rawPermission = useRepoEditPermission(
    () =>
      target?.kind === 'raw'
        ? { owner: target.owner, repo: target.repo, ref: target.ref }
        : { owner: '', repo: '' },
  )

  /** raw 模式是否只读（基于 GitHub API 真实权限，取代旧的 owner/repo 硬编码）。
   *  注意：权限加载中（loading）时保守按只读处理，避免越权编辑。 */
  const isRawReadonly = $derived(
    target?.kind === 'raw' && (!rawPermission.canEdit || rawPermission.loading),
  )

  async function loadPost() {
    if (!target) {
      currentPath = null
      body = ''
      metadata = { date: new Date(), tags: [] }
      return
    }
    const mySeq = ++loadSeq
    loading = true
    error = null
    // 立即清空，避免切换期间显示旧内容（审查 #8 闪烁）
    body = ''
    try {
      let path: string
      if (target.kind === 'raw') {
        path = target.filePath
      } else {
        path = `src/content/${target.collection}/${target.stem}.md`
      }
      // raw 模式：直接调 GitHub Contents API 读（不经 vfsStore，避免主仓库 IndexedDB 污染）。
      // 同时取 sha 用于保存时的乐观锁。
      // content 模式：走 vfsStore.read（三层自动取本地修改 > 只读层 > 在线拉）。
      let text: string
      if (target.kind === 'raw') {
        const result = await getFileWithSha(target.filePath, {
          owner: target.owner,
          repo: target.repo,
          ref: target.ref || undefined,
        })
        text = result.content
        rawSha = result.sha
      } else {
        text = await vfsStore.read(path)
        rawSha = null
      }
      if (mySeq !== loadSeq) return // 已切到别的文章，丢弃结果（竞态防护）
      currentPath = path
      docId = target.kind === 'raw' ? `${target.owner}/${target.repo}/${target.filePath}` : path
      if (target.kind === 'content') {
        // content 模式：解析 frontmatter
        const { metadata: meta, body: parsedBody } = parseMarkdown(text)
        metadata = structuredClone(meta ?? { date: new Date(0), tags: [] })
        body = parsedBody
      } else {
        // raw 模式：纯文本，无 frontmatter 解析
        metadata = { date: new Date(), tags: [] }
        body = text
      }
      // 记录本次加载的 kind，供切换文章前 flush 判断（raw 只读不 flush）
      lastKind = target.kind === 'raw' ? (isRawReadonly ? 'readonly' : 'raw') : 'content'
      dirty = false
    } catch (e) {
      if (mySeq !== loadSeq) return
      error = e instanceof Error ? e.message : '加载失败'
      currentPath = null
    } finally {
      if (mySeq === loadSeq) loading = false
    }
  }

  // 监听目标变化。
  // effect 只追踪 target（同步读取建立依赖）。旧文章状态（currentPath/body 等）
  // 的捕获与 loadPost 调用都放进 untrack，避免它们被注册为依赖导致无限重跑（闪烁 bug）。
  // 切换文章前，非阻塞地 flush 旧内容（同步捕获旧值，不阻塞新文章加载）。
  $effect(() => {
    const next = target
    untrack(() => {
      // 同步捕获旧文章状态，用于切换后非阻塞落盘
      const prevPath = currentPath
      const prevBody = body
      const prevMeta = metadata
      const prevDirty = dirty
      const prevKind = lastKind
      if (next) {
        // 若有未保存的旧内容，非阻塞写入（不 await，不阻塞新文章加载）
        if (prevPath && prevDirty && prevKind !== 'readonly') {
          const content =
            prevKind === 'content' ? serializeMarkdown(prevMeta, prevBody) : prevBody
          vfsStore.write(prevPath, content)
        }
        loadPost()
      } else {
        currentPath = null
      }
    })
  })

  /** 最近一次加载的 target kind（'content' | 'raw' | 'readonly'），供切换前 flush 判断。 */
  let lastKind: 'content' | 'raw' | 'readonly' = 'content'

  function handleInput(value: string) {
    // 只读模式忽略输入
    if (isRawReadonly) return
    body = value
    dirty = true
    scheduleSave()
  }

  function scheduleSave() {
    // 只读模式不调度保存
    if (isRawReadonly) return
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(async () => {
      saveTimer = null
      await flushSave()
    }, 1000)
  }

  /**
   * 立即将当前内容写入 VFS（content 模式）。
   * handleSave/handlePublish/切文章前调用，确保内容不丢。
   * 取消 pending debounce timer，避免重复/错位写入。
   *
   * raw 模式不经 vfsStore（直接走 GitHub Contents API，见 handleRawSave），
   * 此函数对 raw 模式直接 return（切文章前不自动落盘 GitHub，避免误写）。
   */
  async function flushSave(): Promise<void> {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    if (!currentPath) return
    if (target?.kind !== 'content') return // raw 模式不经 vfsStore
    const content = serializeMarkdown(metadata, body)
    await vfsStore.write(currentPath, content)
    contentQuery.refresh()
    dirty = false
  }

  /**
   * raw 模式保存：直接调 GitHub Contents API PUT（不经 vfsStore）。
   * - 无 push 权限/分支保护 → 静默不调（按钮已 disabled）
   * - 成功 → 更新本地 rawSha（下次保存乐观锁）+ toast 提示 commit sha
   */
  async function handleRawSave(): Promise<void> {
    if (target?.kind !== 'raw' || !currentPath) return
    if (!rawPermission.canEdit) return
    rawSaving = true
    try {
      const branch = rawPermission.defaultBranch ?? undefined
      const sha = await updateFileContent(target.filePath, body, {
        owner: target.owner,
        repo: target.repo,
        branch,
        sha: rawSha,
        message: `在线编辑：${target.filePath.split('/').pop() ?? target.filePath}`,
      })
      rawSha = sha // 更新本地 sha，供下次保存乐观锁
      dirty = false
      toast.success(`已保存（commit ${sha.slice(0, 7)}）`, { duration: 2000 })
    } catch (e) {
      // 409 Conflict 通常意味着 sha 过期（期间有新提交），需重新加载
      const msg = e instanceof Error ? e.message : '保存失败'
      toast.error('保存失败', { description: msg, duration: 4000 })
    } finally {
      rawSaving = false
    }
  }

  /** 保存按钮：立即落盘。
   *  content 模式 → flushSave 写 vfsStore（IndexedDB）。
   *  raw 模式 → handleRawSave 直接 PUT GitHub Contents API。 */
  async function handleSave() {
    if (target?.kind === 'raw') {
      await handleRawSave()
      return
    }
    await flushSave()
    toast.success('已保存', { duration: 1500 })
  }

  /**
   * 发表：保存当前文章到 VFS，经 GitService 提交到 GitHub。
   * - 未登录（NotAuthenticatedError）→ 引导到 /app/account 登录。
   * - GitApp 未安装（AppServiceNotInstalled）→ 提示安装 Github 应用。
   * - 成功 → toast 提示 commit sha 前 7 位。
   */
  async function handlePublish() {
    if (!currentPath) return
    publishing = true
    try {
      // 1. 立即保存当前文章到 VFS（flush debounce，确保最新内容落盘）
      await flushSave()

      // 2. 按需获取 Git 服务（会启动 GitApp）
      const git = await gaubeeos.requestAppService('git')

      // 3. 提交（内部 require account 鉴权）
      const title = metadata.title ?? currentPath.split('/').pop() ?? '文章'
      const sha = await git.commit(`发表：${title}`)
      notifySuccess(`已发表（${sha.slice(0, 7)}）`, undefined, {
        label: '查看变更',
        to: targetById('writer.changes'),
      })
    } catch (e) {
      handlePublishError(e, navController)
    } finally {
      publishing = false
    }
  }
</script>

<div class="flex h-full flex-col">
  <!-- 工具栏 -->
  <div class="flex items-center gap-2 border-b border-border px-3 py-1.5">
    <span class="text-muted-foreground truncate text-xs">
      {#if target?.kind === 'content'}
        {target.collection}/{target.stem}
      {:else if target?.kind === 'raw'}
        <span class="font-mono">{target.owner}/{target.repo}/{target.filePath}</span>
      {:else}
        未选择文章
      {/if}
    </span>
    {#if isRawReadonly}
      <span class="text-muted-foreground rounded bg-muted px-1.5 py-0.5 text-[10px]">只读</span>
    {/if}

    <div class="ml-auto flex items-center gap-1">
      <!-- 视图切换 -->
      <Button size="sm" variant={view === 'edit' ? 'default' : 'ghost'} onclick={() => (view = 'edit')}>
        <PencilIcon data-icon="inline-start" />
        <span class="hidden sm:inline">编辑</span>
      </Button>
      <Button size="sm" variant={view === 'split' ? 'default' : 'ghost'} onclick={() => (view = 'split')}>
        <ColumnsIcon data-icon="inline-start" />
        <span class="hidden sm:inline">分屏</span>
      </Button>
      <Button size="sm" variant={view === 'preview' ? 'default' : 'ghost'} onclick={() => (view = 'preview')}>
        <EyeIcon data-icon="inline-start" />
        <span class="hidden sm:inline">预览</span>
      </Button>

      <div class="mx-1 h-5 w-px bg-border"></div>

      <!-- 元数据 + 发表仅 content 模式显示 -->
      {#if target?.kind === 'content'}
        <Button size="sm" variant="ghost" onclick={() => (metadataOpen = true)}>
          <TagsIcon data-icon="inline-start" />
          <span class="hidden sm:inline">元数据</span>
        </Button>
      {/if}
      <Button
        size="sm"
        variant="default"
        onclick={handleSave}
        disabled={
          !currentPath ||
          isRawReadonly ||
          (target?.kind === 'raw' ? rawSaving : false)
        }
      >
        <SaveIcon data-icon="inline-start" />
        <span class="hidden sm:inline">{target?.kind === 'raw' && rawSaving ? '保存中…' : '保存'}</span>
      </Button>
      {#if target?.kind === 'content'}
        <Button
          size="sm"
          variant="secondary"
          onclick={handlePublish}
          disabled={!currentPath || publishing}
        >
          <SendIcon data-icon="inline-start" />
          <span class="hidden sm:inline">{publishing ? '发表中…' : '发表'}</span>
        </Button>
      {/if}
    </div>
  </div>

  <!-- 内容区 -->
  <div class="min-h-0 flex-1">
    {#if !target}
      <div class="text-muted-foreground flex h-full items-center justify-center text-sm">
        请从文件或阅读流中选择一篇文章编辑
      </div>
    {:else if isRawReadonly && !loading}
      <!-- 只读提示（基于 GitHub API 真实权限判定，给出精确原因） -->
      <div class="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 text-sm">
        <LockIcon class="size-6" />
        <p>{rawPermission.disabledReason ?? '加载中…'}</p>
      </div>
    {:else if loading}
      <div class="space-y-2 p-6">
        <Skeleton class="h-6 w-1/3" />
        <Skeleton class="h-4 w-full" />
        <Skeleton class="h-4 w-5/6" />
        <Skeleton class="h-4 w-4/5" />
      </div>
    {:else if error}
      <div class="text-destructive p-6">
        <p class="font-medium">加载失败</p>
        <p class="text-muted-foreground mt-1 text-sm">{error}</p>
      </div>
    {:else if currentPath}
      <div class="flex h-full">
        <!-- 编辑区 -->
        <div class="min-w-0 flex-1 {view === 'preview' ? 'hidden' : ''}">
          <CodeMirror doc={body} {docId} onInput={handleInput} onSave={handleSave} />
        </div>
        <!-- 分屏分隔 -->
        {#if view === 'split'}
          <div class="w-px bg-border"></div>
        {/if}
        <!-- 预览区（MarkdownViewer 渲染） -->
        {#if view === 'split' || view === 'preview'}
          <div class="min-w-0 flex-1 overflow-auto p-6">
            <MarkdownViewer markdown={body} />
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<!-- 元数据编辑弹窗 -->
<Dialog.Root bind:open={metadataOpen}>
  <Dialog.Content class="max-h-[85vh] max-w-lg overflow-hidden p-0" showCloseButton={false}>
    <Dialog.Header class="flex-row items-center gap-2 px-4 pt-4">
      <Dialog.Title>元数据</Dialog.Title>
      <Dialog.Description class="sr-only">
        编辑文章的标题、日期、标签等元数据字段。
      </Dialog.Description>
      <Dialog.Close class="ml-auto">
        <Button variant="ghost" size="icon-sm" aria-label="关闭">
          <XIcon class="size-4" />
        </Button>
      </Dialog.Close>
    </Dialog.Header>
    <div class="max-h-[70vh] overflow-hidden">
      <MetadataEditor bind:metadata oncommit={scheduleSave} />
    </div>
  </Dialog.Content>
</Dialog.Root>
