import { getSvgTemplate } from "../theme/svg-templates";
/**
 * 桌面背景渲染：把 DesktopBackground 配置转成 CSS 背景样式字符串。
 *
 * 正交意图：
 * 1. 原始需求（2026-07-24）：桌面背景支持纯色/渐变/图片/SVG 模板，纯色/渐变/SVG 色相受限。
 *
 * 亮度锁定约束：
 * - 纯色/渐变用 oklch(L C hue) 形式，L/C 固定（与 primary 同亮度），保证可访问性。
 * - SVG 模板内部已通过 var(--primary-h) 引用主题色，色相跟随主题。
 * - 图片无限制（应用浮层会覆盖桌面，不影响可访问性）。
 */
import type { DesktopBackground } from "./service.svelte";

/** 纯色背景的固定 L/C（与亮模式 primary 一致，保证亮度统一）。 */
const COLOR_L = 0.514;
const COLOR_C = 0.222;

/** 把 DesktopBackground 转成内联 style 字符串（用于 DesktopView 根容器）。 */
export function backgroundToCss(bg: DesktopBackground): string {
  switch (bg.type) {
    case "default":
      return "";
    case "color":
      return `background: oklch(${COLOR_L} ${COLOR_C} ${bg.hue});`;
    case "gradient":
      return `background: linear-gradient(135deg, oklch(${COLOR_L} ${COLOR_C} ${bg.from}), oklch(${COLOR_L} ${COLOR_C} ${bg.to}));`;
    case "image":
      return `background: url("${escapeUrl(bg.url)}") center / cover no-repeat;`;
    case "svg":
      // SVG 模板通过 var(--primary-h) 引用主题色相，色相跟随主题。
      // 用 data URL 内联 SVG，preserveAspectRatio=slice 保证铺满。
      return `background: url("data:image/svg+xml;utf8,${encodeURIComponent(getSvgForBackground(bg.templateId))}") center / cover no-repeat;`;
    default:
      return "";
  }
}

/** 转义图片 URL 中的特殊字符（防止 CSS 注入）。 */
function escapeUrl(url: string): string {
  return url.replace(/"/g, "%22");
}

/** 读取 SVG 模板字符串（找不到返回空，降级为无背景）。 */
function getSvgForBackground(templateId: string): string {
  return getSvgTemplate(templateId)?.svg ?? "";
}
