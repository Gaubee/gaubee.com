/**
 * x-highlight.ts — 推文卡片代码块高亮（microlighter，CSS Custom Highlights API）。
 *
 * 用法：`use:xhighlight` 挂在含 .x-arch-code 的容器上（EventBody / 文章详情）。
 * 懒加载：容器里存在 pre>code 才动态 import microlighter（~2KB，语法按需拉取）。
 * 时序：与 xvideo 同理，MarkdownViewer 在 $effect 里注入 HTML，用 MutationObserver
 * 等代码块出现后再高亮（highlightAll 基于 Custom Highlights，不污染 DOM，可重复调）。
 */
export function xhighlight(node: HTMLElement): { destroy: () => void } {
  let destroyed = false;
  let loading = false;

  const maybeHighlight = () => {
    if (destroyed || loading) return;
    if (!node.querySelector("pre > code")) return;
    loading = true;
    import("microlighter")
      .then((m) => m.highlightAll({ root: node, selector: "pre > code" }))
      .catch(() => {});
  };

  maybeHighlight();
  const mo = new MutationObserver(maybeHighlight);
  mo.observe(node, { childList: true, subtree: true });

  return {
    destroy() {
      destroyed = true;
      mo.disconnect();
    },
  };
}
