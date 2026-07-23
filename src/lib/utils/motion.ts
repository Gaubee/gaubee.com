/**
 * 系统级动画工具（纯 svelte 内置 transition/animate 封装）。
 *
 * 统一 prefers-reduced-motion 兜底（尊重用户系统偏好，归零/缩短动画）。
 * 提供常用 transition 工厂，供 AreaOutlet/DesktopView/AreaNav 等系统级动画复用。
 */
import { fade, fly, scale, type TransitionConfig } from "svelte/transition";

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
