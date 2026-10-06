/**
 * 滚动工具：gaubeeOS 的滚动容器是 AreaOutlet 的层容器
 * （.desktop-layer / .app-overlay-layer / .deep-link-layer，absolute + overflow:auto），
 * 不是 window/document——滚动重置必须从内容元素向上遍历真实滚动祖先。
 */

/** 元素或其祖先中真正可滚动的（内容超出可视高度且允许纵向滚动）。 */
function isScrollable(el: HTMLElement): boolean {
  const { overflowY } = getComputedStyle(el)
  if (!(overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay')) return false
  return el.scrollHeight > el.clientHeight
}

/** 把 el 及其所有可滚动祖先的 scrollTop 归零（页面级滚动重置的唯一入口）。 */
export function resetScrollFrom(el: HTMLElement | null | undefined): void {
  if (!el) return
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    if (isScrollable(node)) node.scrollTop = 0
  }
  document.scrollingElement?.scrollTo({ top: 0 })
}
