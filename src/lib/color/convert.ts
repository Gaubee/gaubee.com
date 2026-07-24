/**
 * 颜色格式转换：sRGB ↔ OKLCH（纯函数，无副作用）。
 *
 * 正交意图：
 * 1. 原始需求（2026-07-24）：图片主色提取需把采样 RGB 转 oklch 取 hue 分量。
 *
 * 算法：sRGB [0-255] → linear RGB → LMS → OKLab → OKLCH
 * 参考规范：https://bottosson.github.io/posts/oklab/
 */

export interface Oklch {
  /** 亮度 Lightness [0, 1] */
  L: number;
  /** 彩度 Chroma [0, ~0.4] */
  C: number;
  /** 色相 Hue [0, 360) */
  H: number;
}

/** sRGB 通道 [0, 255] → linear RGB [0, 1]。 */
function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** RGB [0, 255] → OKLCH。 */
export function rgbToOklch(r: number, g: number, b: number): Oklch {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  // linear RGB → LMS（OKLab 转换矩阵第一步）
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  // 非线性化（立方根）
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  // LMS → OKLab
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bAxis = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  // OKLab → OKLCH
  const C = Math.sqrt(a * a + bAxis * bAxis);
  let H = Math.atan2(bAxis, a) * (180 / Math.PI);
  if (H < 0) H += 360;

  return { L, C, H };
}

/** OKLCH → CSS 字符串（如 "oklch(0.514 0.222 16.935)"）。 */
export function oklchToCss({ L, C, H }: Oklch): string {
  return `oklch(${L} ${C} ${H})`;
}

/**
 * 从 RGB 提取色相（Hue），丢弃 L/C。
 * 用于图片主色提取——主题架构只需 hue（L/C 锁定）。
 */
export function rgbToHue(r: number, g: number, b: number): number {
  return rgbToOklch(r, g, b).H;
}
