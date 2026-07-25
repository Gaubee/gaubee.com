import type { Action } from "svelte/action";
/**
 * 系统级动画工具（纯 svelte 内置 transition/animate 封装 + WAAPI action）。
 *
 * 统一 prefers-reduced-motion 兜底（尊重用户系统偏好，归零/缩短动画）。
 * 提供常用 transition 工厂，供 AreaOutlet/DesktopView/AreaNav 等系统级动画复用。
 */
import { fade, fly, scale, type TransitionConfig } from "svelte/transition";

/** blur 进场/离场量（与启动屏 blurIn/blurOut 风格一致，filter:blur 配合 opacity）。 */
const BLUR_PX = 12;

/** 检测用户是否偏好减少动画（SSR 安全）。 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** 按偏好缩放 duration（偏好减少时归零）。 */
function scaledDuration(ms: number): number {
  return prefersReducedMotion() ? 0 : ms;
}

/** fade（带 reduced-motion 兜底）。 */
export function motionFade(
  node: Element,
  params?: { delay?: number; duration?: number },
): TransitionConfig {
  return fade(node, {
    delay: params?.delay ?? 0,
    duration: scaledDuration(params?.duration ?? 180),
  });
}

/** fly（带 reduced-motion 兜底）。 */
export function motionFly(
  node: Element,
  params: { y?: number; x?: number; delay?: number; duration?: number },
): TransitionConfig {
  return fly(node, {
    y: params.y ?? 8,
    x: params.x ?? 0,
    delay: params.delay ?? 0,
    duration: scaledDuration(params.duration ?? 200),
  });
}

/** scale（带 reduced-motion 兜底）。 */
export function motionScale(
  node: Element,
  params?: { start?: number; delay?: number; duration?: number },
): TransitionConfig {
  return scale(node, {
    start: params?.start ?? 0.96,
    delay: params?.delay ?? 0,
    duration: scaledDuration(params?.duration ?? 180),
  });
}

/** flip duration（用于 svelte/animate，列表重排）。 */
export function flipDuration(ms = 220): { duration: number } {
  return { duration: scaledDuration(ms) };
}

/**
 * blur 进场/离场（与启动屏 blurIn/blurOut 风格一致）。
 * 进场：blur(12px)+opacity0 → blur(0)+opacity1。
 * 离场：blur(0)+opacity1 → blur(12px)+opacity0。
 * 用于 deep link 视图等非常驻 DOM 的进场/离场（{#if} 切换场景）。
 * 常驻 DOM（应用浮层/桌面层）用 CSS transition 实现同效果（见 AreaOutlet）。
 */
export function motionBlur(
  node: Element,
  params?: { delay?: number; duration?: number },
): TransitionConfig {
  const duration = scaledDuration(params?.duration ?? 200);
  const delay = params?.delay ?? 0;
  // 用 opacity（fade）+ filter（blur）组合，与启动屏一致
  const baseFade = fade(node, { delay, duration });
  return {
    ...baseFade,
    duration,
    delay,
    css: (t: number) => `filter: blur(${(1 - t) * BLUR_PX}px); opacity: ${t};`,
  };
}

/** WAAPI 动画参数（与启动屏 boot.ts 一致）。 */
const WAAPI_DURATION = 200;
const WAAPI_EASE = "cubic-bezier(0.22, 0.61, 0.36, 1)";

/**
 * blurTransition：常驻 DOM 元素的显隐 WAAPI 动画（blurIn/blurOut + opacity）。
 *
 * 监听元素的 hidden class 变化（通过 MutationObserver），class 添加时触发 blurOut，
 * class 移除时触发 blurIn。动画用 WAAPI（element.animate），默认态 filter:none
 * （不是 blur(0px)），不创建合成层，不影响子元素 backdrop-filter 绘制。
 *
 * 用法（AreaOutlet 的桌面层/应用浮层）：
 * ```svelte
 * <div class="desktop-layer" class:desktop-layer-hidden={!visible} use:blurTransition>
 * ```
 *
 * 与 CSS transition 的区别：WAAPI 动画结束后 filter 归 none（无残留合成层），
 * CSS transition 的 filter:blur(0px) 会持续创建合成层影响子元素绘制。
 */
export const blurTransition: Action<HTMLElement, { hiddenClass: string }> = (node, params) => {
  const hiddenClass = params?.hiddenClass ?? "hidden";

  let currentAnim: Animation | null = null;

  function playBlurIn() {
    if (prefersReducedMotion()) return;
    currentAnim?.cancel();
    currentAnim = node.animate(
      [
        { filter: `blur(${BLUR_PX}px)`, opacity: 0 },
        { filter: "none", opacity: 1 },
      ],
      { duration: WAAPI_DURATION, easing: WAAPI_EASE },
    );
    currentAnim.onfinish = () => {
      // commitStyles 提交最终帧为内联样式，cancel 释放 WAAPI 的 fill 占用。
      // 这样 filter:none 被写入内联样式（而非 blur(0px)），无残留合成层。
      currentAnim?.commitStyles();
      currentAnim?.cancel();
      // 显式覆盖，确保 filter 是 none（commitStyles 可能序列化成 blur(0px)）
      node.style.filter = "none";
    };
  }

  function playBlurOut() {
    if (prefersReducedMotion()) return;
    currentAnim?.cancel();
    currentAnim = node.animate(
      [
        { filter: "none", opacity: 1 },
        { filter: `blur(${BLUR_PX}px)`, opacity: 0 },
      ],
      { duration: WAAPI_DURATION, easing: WAAPI_EASE },
    );
    currentAnim.onfinish = () => {
      currentAnim?.commitStyles();
      currentAnim?.cancel();
    };
  }

  // MutationObserver 监听 class 变化
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes" && mutation.attributeName === "class") {
        const isHidden = node.classList.contains(hiddenClass);
        if (isHidden) {
          playBlurOut();
        } else {
          playBlurIn();
        }
      }
    }
  });

  observer.observe(node, { attributes: true, attributeFilter: ["class"] });

  return {
    update(newParams) {
      // hiddenClass 不可变（class 名固定），无需处理
    },
    destroy() {
      observer.disconnect();
      currentAnim?.cancel();
    },
  };
};
