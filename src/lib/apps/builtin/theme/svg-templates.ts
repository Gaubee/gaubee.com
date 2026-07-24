/**
 * 内置 SVG 动态壁纸模板（2026-07-24）。
 *
 * 每个模板是一段自包含的 SVG 字符串，通过 oklch(var(--primary-h)) 引用主题色相，
 * 支持 SVG animation（渐变流动、呼吸）和 filter（模糊、发光）。
 * 渲染时 DesktopView 把 SVG 作为 data URL 内联到 background-image，--primary-h 由
 * :root 继承（CSS 变量穿透到 SVG inline style），色相旋转即时生效。
 *
 * 设计约束：SVG 内的色相必须走 var(--primary-h) 或 calc 偏移，保持可访问性。
 *
 * 正交意图：
 * 1. 模板定义（id + 名称 + SVG 字符串）。
 */

export interface SvgTemplate {
  id: string;
  name: string;
  /** SVG 字符串（viewBox 16:9，通过 var(--primary-h) 引用主题色）。 */
  svg: string;
}

/**
 * 流动光斑：中心呼吸的径向光晕，配 SVG animate 做半径脉动。
 * 背景 --background 衬底，前景半透明 primary 光斑。
 */
const auroraSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice">
  <defs>
    <radialGradient id="aur" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="oklch(0.75 0.18 var(--primary-h))" stop-opacity="0.55"/>
      <stop offset="60%" stop-color="oklch(0.6 0.2 var(--primary-h))" stop-opacity="0.15"/>
      <stop offset="100%" stop-color="oklch(0.5 0.22 var(--primary-h))" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="aur2" cx="80%" cy="30%" r="40%">
      <stop offset="0%" stop-color="oklch(0.8 0.15 calc(var(--primary-h) + 30))" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="transparent"/>
    </radialGradient>
  </defs>
  <rect width="1920" height="1080" fill="var(--background)"/>
  <circle cx="960" cy="540" r="500" fill="url(#aur)">
    <animate attributeName="r" values="500;580;500" dur="9s" repeatCount="indefinite"/>
  </circle>
  <circle cx="1536" cy="324" r="350" fill="url(#aur2)">
    <animate attributeName="cy" values="324;400;324" dur="11s" repeatCount="indefinite"/>
  </circle>
</svg>`;

/**
 * 网格涟漪：细线网格 + 中心向外的脉冲圆环。
 */
const gridSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice">
  <defs>
    <pattern id="grid" width="80" height="80" patternUnits="userSpaceOnUse">
      <path d="M 80 0 L 0 0 0 80" fill="none" stroke="oklch(0.7 0.05 var(--primary-h))" stroke-width="1" stroke-opacity="0.12"/>
    </pattern>
    <radialGradient id="pulse" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="oklch(0.65 0.2 var(--primary-h))" stop-opacity="0.25"/>
      <stop offset="100%" stop-color="transparent"/>
    </radialGradient>
  </defs>
  <rect width="1920" height="1080" fill="var(--background)"/>
  <rect width="1920" height="1080" fill="url(#grid)"/>
  <circle cx="960" cy="540" r="300" fill="none" stroke="oklch(0.7 0.18 var(--primary-h))" stroke-width="2" stroke-opacity="0.4">
    <animate attributeName="r" values="300;700;300" dur="6s" repeatCount="indefinite"/>
    <animate attributeName="stroke-opacity" values="0.4;0;0.4" dur="6s" repeatCount="indefinite"/>
  </circle>
  <circle cx="960" cy="540" r="600" fill="url(#pulse)"/>
</svg>`;

/**
 * 渐变波浪：多层叠加的流动色带，用 SMIL animate 平移。
 */
const wavesSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="w1" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="oklch(0.7 0.18 var(--primary-h))" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="oklch(0.5 0.2 calc(var(--primary-h) + 20))" stop-opacity="0.1"/>
    </linearGradient>
    <linearGradient id="w2" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="oklch(0.6 0.15 calc(var(--primary-h) - 20))" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="transparent"/>
    </linearGradient>
  </defs>
  <rect width="1920" height="1080" fill="var(--background)"/>
  <ellipse cx="960" cy="700" rx="1200" ry="300" fill="url(#w1)">
    <animateTransform attributeName="transform" type="translate" values="0 0; -100 -20; 0 0" dur="14s" repeatCount="indefinite"/>
  </ellipse>
  <ellipse cx="960" cy="400" rx="1000" ry="250" fill="url(#w2)">
    <animateTransform attributeName="transform" type="translate" values="0 0; 80 30; 0 0" dur="18s" repeatCount="indefinite"/>
  </ellipse>
</svg>`;

/** 内置模板清单。 */
export const SVG_TEMPLATES: readonly SvgTemplate[] = [
  { id: "aurora", name: "极光", svg: auroraSvg },
  { id: "grid", name: "网格", svg: gridSvg },
  { id: "waves", name: "波浪", svg: wavesSvg },
] as const;

/** 按 id 查模板。 */
export function getSvgTemplate(id: string): SvgTemplate | undefined {
  return SVG_TEMPLATES.find((t) => t.id === id);
}
