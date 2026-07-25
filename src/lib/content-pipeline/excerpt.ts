/**
 * 统一 excerpt 算法。
 *
 * 替代项目内散落的 4 份 excerpt 实现：
 * - scripts/build-search-index.ts 的 createExcerpt（★ 基准实现，最完善）
 * - src/lib/apps/views/ArticlesView.svelte 的 body.slice(0,200).replace(/^#+\s*.+\n?/m,'')
 * - src/lib/apps/widget/RecentShoutsWidget.svelte 的 body.replace(/^#.*$/m,'').slice(0,40)
 * - src/lib/views/ArticleView.svelte（无 excerpt，直接渲染 body）
 *
 * 规则（取 build-search-index.ts 的实现）：
 * 1. 去代码块（```...```）
 * 2. 去链接 [text](url)（保留 text）、图片 ![alt](url)
 * 3. 去 markdown 符号 #*_`>~
 * 4. 合并空白
 * 5. 限 180 字符
 */
const EXCERPT_MAX = 180;

/** 从 markdown 正文生成统一摘要。 */
export function createExcerpt(markdown: string, max = EXCERPT_MAX): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?(\[[^\]]*\])\([^)]*\)/g, "$1")
    .replace(/[#>*_`~]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
