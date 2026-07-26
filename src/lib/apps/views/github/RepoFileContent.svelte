<!--
	RepoFileContent：仓库文件内容面板（文件 Tab 右侧）。

	结构：工具栏（文件路径 + Raw|Preview toggle）+ 内容区（独立滚动）。
	- markdown：Preview 用 renderRepoMarkdown 渲染（相对路径重写），Raw 用 <pre> 源码
	- image：<img src={rawUrl}> + photoswipe 全屏查看
	- video：<video src={rawUrl} controls>
	- audio：<audio src={rawUrl} controls>
	- text（代码/纯文本）：<pre> 源码（无 Preview，只显示 Raw）

	内容获取：text/markdown 走 getFileText；媒体走 fileRawUrl（不下载内容，直接用 raw URL）。
-->
<script lang="ts">
  import { getFileText } from '$lib/github/client'
  import { getFileKind, canPreview, type FileKind } from '$lib/github/file-kind'
  import { renderRepoMarkdown, fileRawUrl } from '$lib/apps/installable/github/readme'
  import MarkdownViewer from '$lib/markdown/MarkdownViewer.svelte'
  import { photoswipe } from '$lib/photoswipe/action'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import * as ToggleGroup from '$lib/components/ui/toggle-group'
  import FileTextIcon from '@lucide/svelte/icons/file-text'
  import CodeIcon from '@lucide/svelte/icons/code'
  import EyeIcon from '@lucide/svelte/icons/eye'

  let { path, owner, repo }: { path: string; owner: string; repo: string } = $props()

  const kind = $derived(getFileKind(path))
  const previewable = $derived(canPreview(kind))
  /** 渲染模式：可预览文件默认 preview，纯文本固定 raw。 */
  let mode = $state<'raw' | 'preview'>('preview')

  // 文件内容（text/markdown 才加载；媒体用 rawUrl 不加载内容）
  let content = $state('')
  let loading = $state(false)
  let error = $state<string | null>(null)
  /** markdown Preview 模式的渲染 HTML。 */
  let renderedHtml = $state('')
  /** 媒体文件的 raw URL。 */
  const rawUrl = $derived(fileRawUrl(owner, repo, path))

  // path 变化时重置 + 加载
  $effect(() => {
    const p = path
    // 可预览文件默认 preview 模式，纯文本固定 raw
    mode = previewable ? 'preview' : 'raw'
    renderedHtml = ''
    content = ''
    error = null
    if (kind === 'image' || kind === 'video' || kind === 'audio') {
      // 媒体文件不加载内容，直接用 rawUrl（由模板渲染）
      loading = false
      return
    }
    void loadContent(p)
  })

  // mode 变化时（markdown 切到 preview）才渲染 HTML，避免每次都重算
  $effect(() => {
    if (kind === 'markdown' && mode === 'preview' && content) {
      renderedHtml = renderRepoMarkdown(content, path, owner, repo, { committish: 'HEAD' })
    } else {
      renderedHtml = ''
    }
  })

  async function loadContent(p: string) {
    loading = true
    try {
      content = await getFileText(p, { owner, repo })
    } catch (e) {
      error = e instanceof Error ? e.message : '加载失败'
    } finally {
      loading = false
    }
  }
</script>

<div class="border-border flex h-full min-h-0 min-w-0 flex-col rounded border">
  <!-- 工具栏：文件路径 + Raw|Preview toggle -->
  <div class="border-border flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
    <FileTextIcon class="text-muted-foreground size-3.5 shrink-0" />
    <span class="text-muted-foreground truncate font-mono text-xs" title={path}>{path}</span>
    {#if previewable}
      <ToggleGroup.Root
        bind:value={mode}
        type="single"
        size="sm"
        variant="outline"
        class="ml-auto"
      >
        <ToggleGroup.Item value="raw" class="px-2" aria-label="源码">
          <CodeIcon class="size-3.5" />
        </ToggleGroup.Item>
        <ToggleGroup.Item value="preview" class="px-2" aria-label="预览">
          <EyeIcon class="size-3.5" />
        </ToggleGroup.Item>
      </ToggleGroup.Root>
    {/if}
  </div>

  <!-- 内容区（独立滚动）-->
  <div class="min-h-0 flex-1 overflow-auto p-4">
    {#if loading}
      <Skeleton class="h-40" />
    {:else if error}
      <p class="text-destructive text-sm">{error}</p>
    {:else if kind === 'image'}
      <div class="flex items-center justify-center" use:photoswipe>
        <img src={rawUrl} alt={path} class="max-h-[70vh] max-w-full rounded" loading="lazy" />
      </div>
    {:else if kind === 'video'}
      <div class="flex items-center justify-center">
        <video src={rawUrl} controls class="max-h-[70vh] max-w-full rounded">
          <track kind="captions" />
          您的浏览器不支持视频播放。
        </video>
      </div>
    {:else if kind === 'audio'}
      <div class="flex items-center justify-center py-8">
        <audio src={rawUrl} controls>您的浏览器不支持音频播放。</audio>
      </div>
    {:else if kind === 'markdown' && mode === 'preview' && renderedHtml}
      <div class="prose prose-sm dark:prose-invert max-w-none break-words">
        {@html renderedHtml}
      </div>
    {:else}
      <!-- text 或 markdown raw 模式：源码展示 -->
      <pre class="bg-muted/50 text-xs leading-relaxed whitespace-pre-wrap">{content}</pre>
    {/if}
  </div>
</div>
