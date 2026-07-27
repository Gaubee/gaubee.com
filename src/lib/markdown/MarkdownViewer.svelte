<!--
	MarkdownViewer：统一 Markdown 渲染入口。
	- marked 解析（支持 GFM：表格、任务列表、删除线、autolink）
	- 代码块用 Shiki 高亮（双主题，CSS .dark 切换）
	- 图片响应式（max-width: 100%）
	- 可选截断预览（maxLines + 底部雾化，feed 卡片用）
	- 原始需求（2026-07-21）：长文 TOC 与正文必须使用同一套标题 ID

	用法：<MarkdownViewer markdown="# Hello" /> 或 <MarkdownViewer markdown={post.body} maxLines={8} />
-->
<script lang="ts">
  import { marked } from 'marked'
  import { onMount } from 'svelte'
  import { highlightCode, getHighlighter } from './shiki-highlighter'
  import { configureMarkdownHeadingIds } from './headings'
  import { photoswipe } from '$lib/photoswipe/action'
  import { renderLinkTag, INTERNAL_LINK_ATTR } from './link'
  import { navController } from '$lib/nav/nav-controller-instance'

  let {
    markdown = '',
    /** 截断预览：最多渲染前 maxLines 个非空行，底部雾化（feed 卡片用）。 */
    maxLines,
    /** 内联模式：不添加 prose 包装（用于卡片预览）。 */
    inline = false,
  }: {
    markdown?: string
    maxLines?: number
    inline?: boolean
  } = $props()

  let rendered = $state('')
  let truncated = $state(false)

  // 配置 marked（一次性）；目录从同一规则提取标题 ID。
  configureMarkdownHeadingIds()

  // 自定义 renderer：代码块用 Shiki
  const renderer = new marked.Renderer()
  renderer.code = ({ text, lang }: { text: string; lang?: string }) => {
    const highlighted = highlightCode(text, lang ?? '')
    if (highlighted) return highlighted
    return `<pre><code class="language-${lang ?? 'text'}">${escapeHtml(text)}</code></pre>`
  }
  // 图片响应式
  renderer.image = ({
    href,
    title,
    text,
  }: {
    href: string
    title?: string | null
    text?: string | null
  }) => {
    const t = title ?? ''
    return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text ?? '')}"${t ? ` title="${escapeHtml(t)}"` : ''} loading="lazy" style="max-width:100%;height:auto;border-radius:8px" />`
  }
  // 链接：外链加图标 + 新窗口；内链加 data-internal-link 供点击委托拦截
  renderer.link = ({
    href,
    title,
    tokens,
  }: {
    href: string
    title?: string | null
    tokens: unknown[]
  }) => {
    const text = marked.Parser.parseInline(tokens as never)
    return renderLinkTag({ href, text, title })
  }
  marked.use({ renderer })

  /**
   * markdown 内链接点击委托：
   * - a[data-internal-link]：站内绝对路径 → SPA 导航，避免整页刷新
   * - 其它 a（外链/锚点）：保持浏览器默认行为（外链由 target=_blank 处理）
   * 修饰键（ctrl/meta/shift/alt）与中键/右键不拦截，让用户在新标签打开 fallback。
   * 范式参考 RepoFileContent.svelte 的 data-repo-file 拦截。
   */
  function handleMarkdownClick(e: MouseEvent) {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const anchor = (e.target as HTMLElement | null)?.closest(`a[${INTERNAL_LINK_ATTR}]`)
    if (!anchor) return
    const href = anchor.getAttribute('href')
    if (!href) return
    e.preventDefault()
    navController.navigateMain(href)
  }

  function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  function render() {
    let src = markdown
    truncated = false
    if (maxLines != null && maxLines > 0) {
      const lines = src.split('\n')
      let nonEmpty = 0
      let endIdx = lines.length
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trim() !== '') nonEmpty++
        if (nonEmpty > maxLines) {
          endIdx = i
          truncated = true
          break
        }
      }
      src = lines.slice(0, endIdx).join('\n')
    }
    rendered = marked.parse(src, { async: false }) as string
  }

  // markdown 变化时重渲染
  $effect(() => {
    render()
  })

  // Shiki 加载完成后重新渲染（首帧 highlightCode 返回 null，加载后重试）
  onMount(() => {
    getHighlighter().then(() => {
      render()
    })
  })
</script>

{#if inline}
  <!-- 内联模式：无 prose 包装 -->
  <!-- role=presentation：容器非交互元素，click 仅做事件委托（捕获内部 a[data-internal-link]）。
       交互语义由内部 <a> 承担（键盘可访问）。 -->
  <div use:photoswipe onclick={handleMarkdownClick} role="presentation">
    {@html rendered}
  </div>
{:else}
  <!-- 完整渲染：prose 排版 + 可选截断雾化 -->
  <!-- role=presentation 同上 -->
  <div
    class="prose prose-sm dark:prose-invert max-w-none"
    class:truncate-fade={truncated}
    use:photoswipe
    onclick={handleMarkdownClick}
    role="presentation"
  >
    {@html rendered}
  </div>
{/if}

<style>
  .truncate-fade {
    position: relative;
    max-height: 12rem;
    overflow: hidden;
    mask-image: linear-gradient(to bottom, black 60%, transparent 100%);
    -webkit-mask-image: linear-gradient(to bottom, black 60%, transparent 100%);
  }
</style>
