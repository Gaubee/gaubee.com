<!--
	EditorView：编辑器主页。
	- 从 main location 路径解析要编辑的文章（/editor/{collection}/{stem}）
	- 加载文章内容（VFS 三层读取：本地修改 > 远程缓存 > 在线拉取）
	- 三视图：编辑 / 分屏 / 预览
	- 自动保存到 VFS（dirty 标记），debounce 1s
	- 顶部工具栏：视图切换、元数据编辑、保存
-->
<script lang="ts">
  import CodeMirror from '$lib/editor/CodeMirror.svelte'
  import MetadataEditor from '$lib/editor/MetadataEditor.svelte'
  import MarkdownViewer from '$lib/markdown/MarkdownViewer.svelte'
  import { vfsStore } from '$lib/vfs/vfs.svelte'
  import { navStore } from '$lib/nav/nav.svelte'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { gaubeeos } from '$lib/os/services'
  import { handlePublishError } from '$lib/os/services/publish-helper'
  import { parseMarkdown, serializeMarkdown, type ArticleMetadata } from '$lib/data/frontmatter'
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

  type View = 'edit' | 'split' | 'preview'

  const navState = $derived(navStore.current)
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

  // 从路径解析文章：/editor/articles/0057.tc39-signals
  const targetPost = $derived.by(() => {
    const path = navState.mainLocation.pathname
    const match = path.match(/^\/editor\/(articles|events)\/(.+)$/)
    if (!match) return null
    return { collection: match[1] as 'articles' | 'events', stem: match[2] }
  })

  async function loadPost() {
    if (!targetPost) {
      currentPath = null
      body = ''
      metadata = { date: new Date(), tags: [] }
      return
    }
    const mySeq = ++loadSeq
    const path = `src/content/${targetPost.collection}/${targetPost.stem}.md`
    loading = true
    error = null
    // 立即清空，避免切换期间显示旧内容（审查 #8 闪烁）
    body = ''
    try {
      // VFS.read：三层自动取本地修改 > 缓存 > 在线拉
      const text = await vfsStore.read(path)
      if (mySeq !== loadSeq) return // 已切到别的文章，丢弃结果（竞态防护）
      const { metadata: meta, body: parsedBody } = parseMarkdown(text)
      currentPath = path
      metadata = structuredClone(meta ?? { date: new Date(0), tags: [] })
      body = parsedBody
      docId = path
      dirty = false
    } catch (e) {
      if (mySeq !== loadSeq) return
      error = e instanceof Error ? e.message : '加载失败'
      currentPath = null
    } finally {
      if (mySeq === loadSeq) loading = false
    }
  }

  // 监听目标文章变化
  $effect(() => {
    if (targetPost) {
      loadPost()
    } else {
      currentPath = null
    }
  })

  function handleInput(value: string) {
    body = value
    dirty = true
    scheduleSave()
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(async () => {
      if (!currentPath) return
      const content = serializeMarkdown(metadata, body)
      await vfsStore.write(currentPath, content)
      dirty = false
      toast.success('已暂存', { duration: 1500 })
    }, 1000)
  }

  function handleSave() {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    if (!currentPath) return
    scheduleSave()
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
      // 1. 先保存当前文章到 VFS（同步等待，不依赖 debounce）
      if (saveTimer) {
        clearTimeout(saveTimer)
        saveTimer = null
      }
      const content = serializeMarkdown(metadata, body)
      await vfsStore.write(currentPath, content)
      dirty = false

      // 2. 按需获取 Git 服务（会启动 GitApp）
      const git = await gaubeeos.requestAppService('git')

      // 3. 提交（内部 require account 鉴权）
      const title = metadata.title ?? currentPath.split('/').pop() ?? '文章'
      const sha = await git.commit(`发表：${title}`)
      toast.success(`已发表（${sha.slice(0, 7)}）`)
    } catch (e) {
      handlePublishError(e, navController, toast)
    } finally {
      publishing = false
    }
  }
</script>

<div class="flex h-full flex-col">
  <!-- 工具栏 -->
  <div class="flex items-center gap-2 border-b border-border px-3 py-1.5">
    <span class="text-muted-foreground truncate text-xs">
      {targetPost ? `${targetPost.collection}/${targetPost.stem}` : '未选择文章'}
    </span>

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

      <Button size="sm" variant="ghost" onclick={() => (metadataOpen = true)}>
        <TagsIcon data-icon="inline-start" />
        <span class="hidden sm:inline">元数据</span>
      </Button>
      <Button size="sm" variant="default" onclick={handleSave} disabled={!currentPath}>
        <SaveIcon data-icon="inline-start" />
        <span class="hidden sm:inline">保存</span>
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onclick={handlePublish}
        disabled={!currentPath || publishing}
      >
        <SendIcon data-icon="inline-start" />
        <span class="hidden sm:inline">{publishing ? '发表中…' : '发表'}</span>
      </Button>
    </div>
  </div>

  <!-- 内容区 -->
  <div class="min-h-0 flex-1">
    {#if !targetPost}
      <div class="text-muted-foreground flex h-full items-center justify-center text-sm">
        请从文件或阅读流中选择一篇文章编辑
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
  <Dialog.Content class="max-h-[85vh] max-w-lg overflow-hidden p-0">
    <Dialog.Header class="px-4 pt-4">
      <Dialog.Title>元数据</Dialog.Title>
      <Dialog.Description class="sr-only">
        编辑文章的标题、日期、标签等元数据字段。
      </Dialog.Description>
    </Dialog.Header>
    <div class="max-h-[70vh] overflow-hidden">
      <MetadataEditor bind:metadata oncommit={scheduleSave} />
    </div>
  </Dialog.Content>
</Dialog.Root>
