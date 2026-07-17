<!--
	EditorView：编辑器主页。
	- 从 main location 路径解析要编辑的文章（/editor/{collection}/{stem}）
	- 加载文章内容（contentStore 缓存优先，否则从 GitHub 拉）
	- 三视图：编辑 / 分屏 / 预览（预览在阶段 6 接入 MarkdownViewer，这里占位）
	- 自动保存到 IndexedDB（stagedChanges），debounce 1s
	- 顶部工具栏：视图切换、元数据编辑、保存
-->
<script lang="ts">
  import { onMount } from 'svelte'
  import CodeMirror from '$lib/editor/CodeMirror.svelte'
  import MetadataEditor from '$lib/editor/MetadataEditor.svelte'
  import MarkdownViewer from '$lib/markdown/MarkdownViewer.svelte'
  import { contentStore, type Post } from '$lib/data/content.svelte'
  import { navStore } from '$lib/nav/nav.svelte'
  import { getFileText } from '$lib/github/client'
  import { parseMarkdown, serializeMarkdown, type ArticleMetadata } from '$lib/data/frontmatter'
  import { stageChange } from '$lib/db'
  import { Button } from '$lib/components/ui/button'
  import * as Dialog from '$lib/components/ui/dialog'
  import * as Tabs from '$lib/components/ui/tabs'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import { toast } from 'svelte-sonner'
  import EyeIcon from '@lucide/svelte/icons/eye'
  import ColumnsIcon from '@lucide/svelte/icons/columns-2'
  import PencilIcon from '@lucide/svelte/icons/pencil'
  import TagsIcon from '@lucide/svelte/icons/tags'
  import SaveIcon from '@lucide/svelte/icons/save'

  type View = 'edit' | 'split' | 'preview'

  const navState = $derived(navStore.current)
  let view = $state<View>('edit')
  let metadataOpen = $state(false)
  let loading = $state(false)
  let error = $state<string | null>(null)
  let currentPost = $state<Post | null>(null)
  let metadata = $state<ArticleMetadata>({ date: new Date(), tags: [] })
  let body = $state('')
  /** 文档身份标识（切换文章时变化，触发 CodeMirror 重载）。 */
  let docId = $state('')
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  // 从路径解析文章：/editor/articles/0057.tc39-signals
  const targetPost = $derived.by(() => {
    const path = navState.mainLocation.pathname
    const match = path.match(/^\/editor\/(articles|events)\/(.+)$/)
    if (!match) return null
    return { collection: match[1] as 'articles' | 'events', stem: match[2] }
  })

  async function loadPost() {
    if (!targetPost) {
      currentPost = null
      return
    }
    loading = true
    error = null
    try {
      // 先从 contentStore 找缓存
      let post = contentStore.findPost(targetPost.collection, targetPost.stem)
      if (!post) {
        // contentStore 没加载，直接拉文件
        const path = `src/content/${targetPost.collection}/${targetPost.stem}.md`
        const text = await getFileText(path)
        const parsed = parseMarkdown(text)
        post = {
          path,
          collection: targetPost.collection,
          filename: `${targetPost.stem}.md`,
          id: { seq: '', slug: '', stem: targetPost.stem },
          metadata: parsed.metadata ?? { date: new Date(0), tags: [] },
          body: parsed.body,
          sha: '',
        }
      }
      currentPost = post
      metadata = structuredClone(post.metadata)
      body = post.body
      docId = post.path // 切换文档身份
    } catch (e) {
      error = e instanceof Error ? e.message : '加载失败'
    } finally {
      loading = false
    }
  }

  // 监听目标文章变化
  $effect(() => {
    if (targetPost) {
      loadPost()
    } else {
      currentPost = null
    }
  })

  function handleInput(value: string) {
    body = value
    scheduleSave()
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(async () => {
      if (!currentPost) return
      const content = serializeMarkdown(metadata, body)
      await stageChange(currentPost.path, content)
      toast.success('已暂存', { duration: 1500 })
    }, 1000)
  }

  function handleSave() {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    if (!currentPost) return
    scheduleSave()
  }
</script>

<div class="flex h-full flex-col">
  <!-- 工具栏 -->
  <div class="flex items-center gap-2 border-b border-border px-3 py-1.5">
    <span class="text-muted-foreground truncate text-xs">
      {currentPost ? `${currentPost.collection}/${currentPost.id.stem}` : '未选择文章'}
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
      <Button size="sm" variant="default" onclick={handleSave} disabled={!currentPost}>
        <SaveIcon data-icon="inline-start" />
        <span class="hidden sm:inline">保存</span>
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
    {:else if currentPost}
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
    </Dialog.Header>
    <div class="max-h-[70vh] overflow-hidden">
      <MetadataEditor bind:metadata oncommit={scheduleSave} />
    </div>
  </Dialog.Content>
</Dialog.Root>
