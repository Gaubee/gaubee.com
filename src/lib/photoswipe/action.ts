/**
 * PhotoSwipe v5 图片查看器（Svelte action）。
 *
 * 正交意图：
 * 1. 原始需求（2026-07-24）：点击文章/说说中的图片，展开专业图片查看器。
 *
 * 设计：
 * - Svelte action：挂在内容容器上（{@html} 渲染的父元素），PhotoSwipe 自动绑定 img click。
 * - 预初始化：action 挂载时立即 init lightbox（init 只绑定 click handler，不加载 core）。
 *   core 在首次 open 时由 pswpModule 动态 import（懒加载，不进首屏 bundle）。
 *   必须预 init——否则首次点击时 PhotoSwipe handler 还没绑定，事件已错过。
 * - domItemData filter：从被点击 img 的 naturalWidth/Height 动态获取尺寸，
 *   image renderer 无需声明 data-pswp-width/height。
 * - cursor:pointer 提示可点击。
 *
 * 导入路径：photoswipe 用 exports 字段，子路径为 `photoswipe/lightbox` 和 `photoswipe`。
 */
import type PhotoSwipeLightboxType from "photoswipe/lightbox";
import type { Action } from "svelte/action";

import "photoswipe/dist/photoswipe.css";

/**
 * Svelte action：为容器内的图片启用 PhotoSwipe 查看器。
 *
 * 用法：
 * ```svelte
 * <div use:photoswipe>{@html content}</div>
 * ```
 * 容器内所有 `<img>` 点击后在 PhotoSwipe 全屏查看器中打开，支持缩放/拖拽/键盘。
 */
export const photoswipe: Action<HTMLElement> = (container) => {
  let lightbox: PhotoSwipeLightboxType | null = null;

  // 预初始化：action 挂载时立即 import lightbox + init。
  // lightbox 的 init 只绑定容器内 img 的 click handler，不加载 core；
  // core 在首次 open 时由 pswpModule 动态 import（懒加载，不进首屏 bundle）。
  const initPromise = import("photoswipe/lightbox").then(({ default: PhotoSwipeLightbox }) => {
    const lb = new PhotoSwipeLightbox({
      gallery: container,
      children: "img",
      pswpModule: () => import("photoswipe"),
      padding: { top: 20, bottom: 20, left: 20, right: 20 },
      bgOpacity: 0.9,
      showHideAnimationType: "fade",
    });

    // 动态尺寸：从被点击 img 的 naturalWidth/Height 读取（已加载，无需异步）。
    // PhotoSwipe addFilter 类型签名极复杂（PhotoSwipeFiltersMap 映射），用类型断言绕过。
    const filterFn = (itemData: Record<string, unknown>, element: Element) => {
      const img = element as HTMLImageElement;
      if (img?.naturalWidth) {
        itemData.w = img.naturalWidth;
        itemData.h = img.naturalHeight;
        itemData.src = img.src;
        itemData.msrc = img.src;
        if (img.alt) itemData.alt = img.alt;
      }
      return itemData;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lb.addFilter("domItemData", filterFn as any);

    lb.init();
    lightbox = lb;
    return lb;
  });

  // cursor:pointer 提示图片可点击
  container.classList.add("pswp-clickable");

  return {
    destroy() {
      container.classList.remove("pswp-clickable");
      // lightbox 可能还在 import 中，等 init 完成再 destroy
      initPromise.then((lb) => lb.destroy());
    },
  };
};
