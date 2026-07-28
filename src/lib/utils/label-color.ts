/**
 * label-color：GitHub Label 颜色处理工具。
 *
 * 设计意图（2026-07-27）：
 * GitHub 的 issue/PR labels 自带 hex 颜色。要在 UI 上还原 GitHub 的视觉风格，
 * 需要：
 * 1. 把 hex 转成 CSS 可用格式
 * 2. 根据背景亮度选择前景文字颜色（黑/白），保证可读性（WCAG 对比度）
 * 3. 提供半透明背景版本（用于 hover/淡色场景）
 *
 * 算法：相对亮度（Relative Luminance）按 WCAG 2.1 规范计算。
 * 亮度 > 0.5 视为浅色背景 → 用深色文字；否则用浅色文字。
 */

/** hex 颜色（如 "d73a4a" 或 "#d73a4a"）转 [r, g, b]，失败返回 null。 */
export function hexToRgb(hex: string): [number, number, number] | null {
  const cleaned = hex.replace(/^#/, "").trim();
  // 支持 3 位（#fff）和 6 位（#ffffff）
  const full =
    cleaned.length === 3
      ? cleaned
          .split("")
          .map((c) => c + c)
          .join("")
      : cleaned;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return [r, g, b];
}

/**
 * 计算 sRGB 颜色的相对亮度（WCAG 2.1）。
 * 返回 0~1 的值，越大越亮。
 */
function relativeLuminance(r: number, g: number, b: number): number {
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** Label 颜色的派生样式（前景 + 背景 + 边框）。
 *  - 背景：label 原色（不透明，GitHub 风格）
 *  - 前景：根据背景亮度自动黑/白
 *  - 边框：略暗的原色（避免与背景同色无边界感） */
export interface LabelColorStyle {
  /** 前景文字色（"#000" 或 "#fff"）。 */
  color: string;
  /** 背景色（"rgb(r,g,b)"）。 */
  backgroundColor: string;
  /** 边框色（略暗的半透明原色）。 */
  borderColor: string;
}

/**
 * 根据 label 的 hex 颜色计算完整的 badge 样式。
 * @param hex GitHub label color（如 "d73a4a"）
 * @returns LabelColorStyle；hex 无效时返回灰色默认值
 */
export function deriveLabelStyle(hex: string): LabelColorStyle {
  const rgb = hexToRgb(hex);
  if (!rgb) {
    return {
      color: "var(--foreground)",
      backgroundColor: "var(--muted)",
      borderColor: "var(--border)",
    };
  }
  const [r, g, b] = rgb;
  const luminance = relativeLuminance(r, g, b);
  // GitHub 用 0.4 作为阈值（偏保守，深色 label 即使用深色文字）
  const isLight = luminance > 0.5;
  return {
    color: isLight ? "#1f2328" : "#ffffff",
    backgroundColor: `rgb(${r}, ${g}, ${b})`,
    borderColor: `rgba(${r}, ${g}, ${b}, 0.6)`,
  };
}

/** 把 hex 转 inline style 字符串（直接用于 style 属性）。 */
export function labelStyleString(hex: string): string {
  const s = deriveLabelStyle(hex);
  return `color: ${s.color}; background-color: ${s.backgroundColor}; border-color: ${s.borderColor};`;
}
