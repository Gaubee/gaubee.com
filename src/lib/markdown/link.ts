/**
 * Markdown 链接统一处理（客户端 MarkdownViewer + SSG render.ts 共享）。
 *
 * 原始需求（2026-07-28）：文章/说说正文链接需明确区分外链与内链：
 * - 外链（http/https/mailto/tel 绝对 URL）：带尾部图标 + 新窗口打开
 * - 内链（站内绝对路径 /xxx）：走应用内 SPA 导航，避免整页刷新
 *
 * 与 readme.ts 的分工：
 * - 本模块面向「文章/说说正文」通用场景，不处理仓库相对路径语义。
 * - readme.ts 的 data-repo-file（指向文件面板）是 GitHub 专属语义，保持独立。
 */

/** 链接分类。决定 renderer.link 输出的属性与后续客户端拦截行为。 */
export type LinkKind = "external" | "internal" | "anchor" | "other";

/**
 * 分类链接 href。
 *
 * - external：`http(s)://`、`mailto:`、`tel:` 等带协议的绝对 URL（含 `//host` 协议相对 URL）
 * - internal：站内绝对路径，以 `/` 开头但不是 `//host`（`/articles/foo`）
 * - anchor：页内锚点，以 `#` 开头
 * - other：相对路径（`./x`、`x.md`），由调用方按场景处理（通用正文不处理，README 改写为仓库链接）
 */
export function classifyLink(href: string): LinkKind {
  if (!href) return "other";
  if (href.startsWith("#")) return "anchor";
  // 协议相对 URL（//host/path）按外链处理
  if (href.startsWith("//")) return "external";
  if (href.startsWith("/")) return "internal";
  // 常见绝对协议
  if (/^(https?:|mailto:|tel:|ftp:|ftps:|news:|irc:)/i.test(href)) return "external";
  return "other";
}

/** HTML 属性转义（防 XSS：href/title 注入）。 */
function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 外链图标 class（CSS ::after + mask 渲染，DOM 零增节点）。 */
export const EXTERNAL_LINK_CLASS = "md-link-external";
/** 内链 data 属性（客户端 click 委托识别，命中即走 SPA 导航）。 */
export const INTERNAL_LINK_ATTR = "data-internal-link";

/**
 * 生成 `<a>` 标签 HTML（供 marked renderer.link 返回）。
 *
 * - external：加 `target="_blank"` + `rel="noopener noreferrer"` + 外链图标 class
 * - internal：加 `data-internal-link`（SSG 无 JS 时保持原生跳转，data 属性无害）
 * - anchor/other：保持 marked 默认输出形态
 *
 * @param opts.href    原 href（已由 marked 提供）
 * @param opts.text    已 parseInline 的内联 HTML（调用方负责）
 * @param opts.title   可选 title
 */
export function renderLinkTag(opts: { href: string; text: string; title?: string | null }): string {
  const { href, text } = opts;
  const title = opts.title ?? "";
  const titleAttr = title ? ` title="${escapeAttr(title)}"` : "";
  const kind = classifyLink(href);

  if (kind === "external") {
    return `<a href="${escapeAttr(href)}"${titleAttr} class="${EXTERNAL_LINK_CLASS}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  }
  if (kind === "internal") {
    return `<a href="${escapeAttr(href)}"${titleAttr} ${INTERNAL_LINK_ATTR}>${text}</a>`;
  }
  return `<a href="${escapeAttr(href)}"${titleAttr}>${text}</a>`;
}
