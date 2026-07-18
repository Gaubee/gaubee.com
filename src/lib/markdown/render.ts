/**
 * 纯 Markdown 渲染函数（构建期 SSG 用）。
 *
 * 构建期（SSG +page.server.ts）调用，把 markdown 预渲染成 HTML 字符串，
 * 让文章正文进入静态 HTML（SEO 关键）。代码块用 Shiki 高亮。
 *
 * 说明：
 * - marked 的 renderer 始终同步返回 string（async renderer 在 marked v18
 *   实测会输出 [object Promise]）。
 * - 因此本函数保持同步签名。调用方需在调用前 `await ensureShikiLoaded()`
 *   确保 Shiki highlighter 已加载（否则代码块退回 plain code）。
 * - 客户端 MarkdownViewer 走另一条路径（shiki-highlighter.ts 的同步
 *   highlightCode + onMount 重渲染），不经过本函数。
 */
import { marked } from "marked";
import { gfmHeadingId } from "marked-gfm-heading-id";
import { highlightCode, primeHighlighter } from "./shiki-highlighter";

let configured = false;

function ensureConfigured() {
  if (configured) return;
  marked.use(gfmHeadingId());
  configured = true;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 确保 Shiki highlighter 已加载（构建期调用）。
 * 在 renderMarkdown 前调用一次，保证后续同步 highlightCode 能拿到缓存的实例。
 */
export async function ensureShikiLoaded(): Promise<void> {
  await primeHighlighter();
}

/**
 * 渲染 markdown 为 HTML（同步，需先 await ensureShikiLoaded）。
 * 代码块用 Shiki 高亮（已加载则高亮，否则 plain code）。
 * 图片响应式 + lazy，属性已 HTML 转义防 XSS。
 *
 * 注意：renderer 必须通过 `marked.use({ renderer })` 注册才生效，
 * 仅 `new marked.Renderer()` + 赋值方法不会影响 marked.parse。
 */
export function renderMarkdown(src: string): string {
  ensureConfigured();

  const renderer = new marked.Renderer();
  renderer.code = ({ text, lang }) => {
    const highlighted = highlightCode(text, lang ?? "");
    if (highlighted) return highlighted;
    return `<pre><code class="language-${escapeHtml(lang ?? "text")}">${escapeHtml(text)}</code></pre>`;
  };
  renderer.image = ({ href, title, text }) => {
    const t = title ?? "";
    return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text ?? "")}"${t ? ` title="${escapeHtml(t)}"` : ""} loading="lazy" style="max-width:100%;height:auto;border-radius:8px" />`;
  };
  marked.use({ renderer });

  return marked.parse(src, { async: false }) as string;
}
