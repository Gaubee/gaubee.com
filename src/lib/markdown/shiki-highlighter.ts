/**
 * Shiki 高亮器单例：懒加载 + 缓存。
 * 双主题（github-light-default / github-dark-default），代码块在 marked renderer 里调用。
 */
import { createHighlighter, type Highlighter } from "shiki";

let highlighterPromise: Promise<Highlighter> | null = null;

/** 预加载的常用语言。 */
const CORE_LANGS = [
  "javascript",
  "typescript",
  "json",
  "yaml",
  "markdown",
  "bash",
  "shell",
  "html",
  "css",
  "svelte",
] as const;

async function create(): Promise<Highlighter> {
  return createHighlighter({
    themes: ["github-light-default", "github-dark-default"],
    langs: [...CORE_LANGS],
  });
}

export function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = create();
  }
  return highlighterPromise;
}

/** 同步获取缓存的 highlighter（首次可能为 null）。 */
let cached: Highlighter | null = null;
getHighlighter().then((h) => {
  cached = h;
});

export function getHighlighterSync(): Highlighter | null {
  return cached;
}

/**
 * 同步高亮代码块（用于 marked renderer，首帧可能返回 null → 退回 plain code）。
 * 双主题输出：同时渲染 light + dark，CSS 根据当前主题显示对应块。
 */
export function highlightCode(code: string, lang: string): string | null {
  if (!cached) return null;
  try {
    return cached.codeToHtml(code, {
      lang: lang || "text",
      themes: {
        light: "github-light-default",
        dark: "github-dark-default",
      },
      defaultColor: false, // 用 CSS 媒体查询/.dark 切换
    });
  } catch {
    return null;
  }
}
