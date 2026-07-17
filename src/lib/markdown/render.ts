/**
 * 纯 Markdown 渲染函数（server/client 共用）。
 *
 * 构建期（SSG +page.server.ts）调用，把 markdown 预渲染成 HTML 字符串，
 * 让文章正文进入静态 HTML（SEO 关键）。客户端 MarkdownViewer 复用同一管线。
 */
import { marked } from "marked";
import { gfmHeadingId } from "marked-gfm-heading-id";

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
 * 渲染 markdown 为 HTML。同步（marked.parse async:false）。
 * 代码块用 Shiki 高亮（已加载则高亮，否则 plain code）。
 * 图片响应式 + lazy。
 */
export function renderMarkdown(src: string): string {
  ensureConfigured();

  const renderer = new marked.Renderer();
  renderer.code = ({ text, lang }) => {
    // Shiki 同步高亮（需预先加载 highlighter）
    try {
      // 动态 require 避免在未加载时硬依赖
      const mod = globalThis as unknown as {
        __shikiHighlightCode?: (c: string, l: string) => string | null;
      };
      if (mod.__shikiHighlightCode) {
        const highlighted = mod.__shikiHighlightCode(text, lang ?? "");
        if (highlighted) return highlighted;
      }
    } catch {
      // 忽略，用 fallback
    }
    return `<pre><code class="language-${escapeHtml(lang ?? "text")}">${escapeHtml(text)}</code></pre>`;
  };
  renderer.image = ({ href, title, text }) => {
    const t = title ?? "";
    return `<img src="${escapeHtml(href)}" alt="${escapeHtml(text ?? "")}"${t ? ` title="${escapeHtml(t)}"` : ""} loading="lazy" style="max-width:100%;height:auto;border-radius:8px" />`;
  };

  return marked.parse(src, { async: false }) as unknown as string;
}
