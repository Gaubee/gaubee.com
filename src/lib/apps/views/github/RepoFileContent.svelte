<!--
	RepoFileContent：仓库文件内容面板（文件 Tab 右侧）。

	结构：工具栏（文件路径 + Raw|Preview toggle + download/edit）+ 内容区（独立滚动）。
	- markdown：Preview 用 renderRepoMarkdown 渲染（相对路径重写），Raw 用 <pre> 源码
	- image：<img src={rawUrl}> + photoswipe 全屏查看
	- video/audio：<video>/<audio src={rawUrl} controls>
	- text（代码/纯文本）：Shiki 代码高亮（Raw 模式）

	内容获取：text/markdown 走 getFileText；媒体走 fileRawUrl（不下载内容，直接用 raw URL）。
	raw URL 用仓库 default_branch（如 main），GitHub raw 端点只认分支名。

	状态机升级（2026-07-28）：content 用 createResource 收口 loading/error。
	媒体短路：image/video/audio 不发请求，直接 setData(null) 跳过 loading（用 rawUrl 渲染）。
	Shiki 二次异步高亮：content 就绪后 primeHighlighter，用 setData 更新（保持 resource 单源）。

	响应式：
	- 桌面端（md+）：h-full（grid cell 撑满）+ 内容区 overflow-auto 独立滚动
	- 移动端（<md）：无固定高度，内容自然撑开，让 app 内容区滚动；
	  工具栏含"文件列表"按钮（primary 样式）触发文件树 Sheet
-->
<script lang="ts">
  import { getFileText } from '$lib/github/client'
  import { getFileKind, canPreview, type FileKind } from '$lib/github/file-kind'
  import { renderRepoMarkdown, fileRawUrl } from '$lib/apps/installable/github/readme'
  import { type RepoPermissions } from '$lib/apps/installable/github/repo-api'
  import MarkdownViewer from '$lib/markdown/MarkdownViewer.svelte'
  import { highlightCode, primeHighlighter } from '$lib/markdown/shiki-highlighter'
  import { photoswipe } from '$lib/photoswipe/action'
  import { navController } from '$lib/nav/nav-controller-instance'
  import { Skeleton } from '$lib/components/ui/skeleton'
  import { Button, buttonVariants } from '$lib/components/ui/button'
  import * as ToggleGroup from '$lib/components/ui/toggle-group'
  import * as Tooltip from '$lib/components/ui/tooltip'
  import { createResource } from '$lib/apps/installable/github/state'
  import RepoEditPermission from './RepoEditPermission.svelte'
  import FileTextIcon from '@lucide/svelte/icons/file-text'
  import FolderTreeIcon from '@lucide/svelte/icons/folder-tree'
  import CodeIcon from '@lucide/svelte/icons/code'
  import EyeIcon from '@lucide/svelte/icons/eye'
  import DownloadIcon from '@lucide/svelte/icons/download'
  import PencilIcon from '@lucide/svelte/icons/pencil'

  let {
    path,
    owner,
    repo,
    branch = '',
    commitSha = '',
    permissions,
    onopenfiletree = () => {},
    onopenfile = () => {},
  }: {
    path: string
    owner: string
    repo: string
    /** 仓库默认分支（用于 raw URL + markdown 相对路径重写）。 */
    branch?: string
    /** commit SHA（按历史版本访问时传入，优先于 branch）。 */
    commitSha?: string
    /** 当前 token 对该仓库的权限（来自 repoInfo.permissions，由父组件下传）。 */
    permissions?: RepoPermissions
    /** 移动端：打开文件树浮层（桌面端不显示触发按钮）。 */
    onopenfiletree?: () => void
    /** markdown 内相对链接点击：打开应用内文件（SPA 导航到 ?file=path）。
     *  由 renderRepoMarkdown 生成的 <a data-repo-file="path"> 触发。 */
    onopenfile?: (filePath: string) => void
  } = $props()

  const kind = $derived(getFileKind(path))
  const previewable = $derived(canPreview(kind))
  /** 渲染模式：可预览文件默认 preview，纯文本固定 raw。 */
  let mode = $state<'raw' | 'preview'>('preview')

  /** 是否需要加载文件内容（text/markdown 走 getFileText；媒体用 rawUrl 不加载）。 */
  const needsFetch = $derived(kind === 'text' || kind === 'markdown')

  // 文件内容资源（text/markdown）；媒体文件不使用此 resource（用 rawUrl 渲染）
  const contentResource = createResource(
    () => getFileText(path, { owner, repo, ref: commitSha || undefined }),
    { errorMessage: '加载失败' },
  )

  /** markdown Preview 模式的渲染 HTML（派生自 contentResource.data）。 */
  let renderedHtml = $state('')
  /** text 类的高亮 HTML（Shiki）。 */
  let highlightedHtml = $state('')
  /** 实际 ref：commitSha 优先（历史版本），否则用 branch（默认分支）。 */
  const effectiveRef = $derived(commitSha || branch)

  /** 媒体/下载用的 raw URL（commitSha 优先）。 */
  const rawUrl = $derived(fileRawUrl(owner, repo, path, effectiveRef))

  // path 变化时重置 + 加载（媒体短路不发请求）
  // reset 清空旧内容：不同文件内容完全不同，走骨架而非 refreshing。
  $effect(() => {
    const p = path
    // 可预览文件默认 preview 模式，纯文本固定 raw
    mode = previewable ? 'preview' : 'raw'
    renderedHtml = ''
    highlightedHtml = ''
    if (needsFetch) {
      contentResource.reset()
      void contentResource.run()
    } else {
      // 媒体文件：不发请求，重置 resource（避免残留旧 text 内容）
      contentResource.reset()
    }
    void p
  })

  // markdown 渲染（contentResource.data 就绪 + preview 模式时计算）
  $effect(() => {
    const content = contentResource.data
    if (kind === 'markdown' && mode === 'preview' && content) {
      renderedHtml = renderRepoMarkdown(content, path, owner, repo, { branch: effectiveRef })
    } else {
      renderedHtml = ''
    }
  })

  // text 类代码高亮：content 就绪 + Shiki 加载后计算
  $effect(() => {
    const content = contentResource.data
    if (kind === 'text' && content) {
      const lang = path.split('.').pop() ?? ''
      const html = highlightCode(content, lang)
      highlightedHtml = html ?? ''
    } else {
      highlightedHtml = ''
    }
  })

  /** 跳转到 GithubEditorApp 编辑器（由 RepoEditPermission 守卫，按钮 disabled 时不会触发）。
   *  带 ref 参数传递当前 git ref（commitSha 优先，否则默认分支），让编辑器准确判定权限。
   *  注意：RepoEditPermission 已守卫「非默认分支不可编辑」，所以这里即便带了 ref，
   *  编辑器仍会基于 ref === default_branch 判定。 */
  function handleEdit() {
    const refParam = commitSha ? `&ref=${encodeURIComponent(commitSha)}` : ''
    navController.navigateMain(
      `/app/github-editor/repo/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}?file=${encodeURIComponent(path)}${refParam}`,
    )
  }

  /** 下载文件（用 raw URL）。 */
  const downloadHref = $derived(rawUrl)

  /** markdown 容器引用（bind:this，用于 click 委托）。 */
  let markdownEl: HTMLDivElement | undefined = $state()

  /** markdown 内链接点击委托：
   *  - a[data-repo-file]：相对路径链接 → 应用内导航（onopenfile 回调），阻止默认跳转 GitHub
   *  - 其它 a（绝对 URL、锚点）：保持浏览器默认行为
   *  中键/ctrl/meta/shift 点击不拦截（让用户在新标签打开 fallback href）。 */
  function handleMarkdownClick(e: MouseEvent) {
    if (!(e.currentTarget instanceof HTMLElement)) return
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const anchor = (e.target as HTMLElement | null)?.closest('a[data-repo-file]')
    if (!anchor) return
    const filePath = anchor.getAttribute('data-repo-file')
    if (!filePath) return
    e.preventDefault()
    onopenfile(filePath)
  }
</script>

<!-- Tooltip.Provider 包裹整个文件面板：编辑按钮的 disabled tooltip 共享 delay 配置。
     bits-ui 要求 Tooltip.Root 必须在 Provider 内部，否则抛 Context not found。 -->
<Tooltip.Provider delayDuration={200}>
  <div class="border-border flex min-w-0 flex-col rounded border">
    <!-- 工具栏：文件路径 + 操作按钮 + Raw|Preview toggle -->
    <div class="border-border flex shrink-0 items-center gap-1.5 border-b px-2 py-1.5">
    <!-- 移动端：文件列表触发按钮（primary 样式，桌面端隐藏）-->
    <Button
      size="sm"
      variant="default"
      class="md:hidden"
      onclick={onopenfiletree}
      aria-label="打开文件列表"
    >
      <FolderTreeIcon class="size-4" />
    </Button>
    <FileTextIcon class="text-muted-foreground size-3.5 shrink-0 max-md:hidden" />
    <span class="text-muted-foreground truncate font-mono text-xs" title={path}>{path}</span>

    <!-- 操作按钮组（inline-end）-->
    <div class="ml-auto flex shrink-0 items-center gap-0.5">
      <!-- 下载（原生 a 标签，配 button 样式）-->
      <a
        href={downloadHref}
        download={path.split('/').pop()}
        target="_blank"
        rel="noopener"
        class={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
        aria-label="下载"
      >
        <DownloadIcon class="size-3.5" />
      </a>
      <!-- 编辑：基于仓库/分支/保护状态三层判定（RepoEditPermission 守卫）。
           可编辑 → 普通按钮；不可编辑 → Tooltip 包 disabled button（外层 span 接收 pointer events）。
           注意：snippet 接收 canEdit/disabledReason 两个独立参数（非对象）保证响应性，
           snippet 内部用 {$derived} 重新读取以建立依赖追踪。 -->
      <RepoEditPermission {owner} {repo} {permissions} {branch} commitSha={commitSha}>
        {#snippet children(canEdit, disabledReason)}
          {#if canEdit}
            <Button size="icon-sm" variant="ghost" onclick={handleEdit} aria-label="编辑">
              <PencilIcon class="size-3.5" />
            </Button>
          {:else}
            <Tooltip.Root>
              <!-- 不用 disabled 属性（会让 pointer-events:none，tooltip 无法触发）。
                   改用 aria-disabled + tabindex=-1 + cursor-not-allowed 模拟禁用形态，
                   保留 hover 能力让 Tooltip 正常显示原因。 -->
              <Tooltip.Trigger
                aria-disabled="true"
                tabindex={-1}
                class="text-muted-foreground/50 inline-flex size-7 cursor-not-allowed items-center justify-center rounded"
                aria-label="编辑（不可用）"
              >
                <PencilIcon class="size-3.5" />
              </Tooltip.Trigger>
              <Tooltip.Content>{disabledReason}</Tooltip.Content>
            </Tooltip.Root>
          {/if}
        {/snippet}
      </RepoEditPermission>
      <!-- Raw|Preview toggle（仅可预览文件）-->
      {#if previewable}
        <ToggleGroup.Root
          bind:value={mode}
          type="single"
          size="sm"
          variant="outline"
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
  </div>

  <!-- 内容区：直接展开，由 app 内容区滚动（桌面端和移动端统一）-->
  <div class="p-4">
    {#if kind === 'image'}
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
    {:else if contentResource.status === 'loading'}
      <Skeleton class="h-40" />
    {:else if contentResource.status === 'error' || contentResource.status === 'stale-error'}
      <p class="text-destructive text-sm">{contentResource.error}</p>
    {:else if kind === 'markdown' && mode === 'preview' && renderedHtml}
      <!-- role=presentation：容器本身非交互元素，click 仅做事件委托（捕获内部 a[data-repo-file]）。
           交互语义由内部的 <a> 承担（键盘可访问）。 -->
      <div
        bind:this={markdownEl}
        onclick={handleMarkdownClick}
        role="presentation"
        class="prose prose-sm dark:prose-invert max-w-none break-words"
      >
        {@html renderedHtml}
      </div>
    {:else if kind === 'text' && highlightedHtml}
      <!-- Shiki 代码高亮（双主题）-->
      <div class="dark:prose-invert prose prose-sm max-w-none">
        {@html highlightedHtml}
      </div>
    {:else if contentResource.data}
      <!-- text 无高亮（Shiki 未加载或不支持的语言）或 markdown raw 模式：纯源码 -->
      <pre class="bg-muted/50 text-xs leading-relaxed whitespace-pre-wrap">{contentResource.data}</pre>
    {/if}
  </div>
  </div>
</Tooltip.Provider>
