// src/plugins/blurhash-to-css.ts

// --- 辅助函数 ---

const CHARACTERS =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~";

function decode83(str: string): number {
  let value = 0;
  for (let i = 0; i < str.length; i++) {
    value = value * 83 + CHARACTERS.indexOf(str[i]);
  }
  return value;
}

function srgbToLinear(value: number): number {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearToSrgb(value: number): number {
  const v = Math.max(0, Math.min(1, value));
  const result =
    v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.round(result * 255);
}

function signPow(value: number, exp: number): number {
  return Math.sign(value) * Math.pow(Math.abs(value), exp);
}

// --- 核心转换逻辑 ---

interface BlurhashCssProperties {
  "background-image": string;
  "background-position": string;
  "background-size": string;
  "background-repeat": "no-repeat";
}

/**
 * 将 Blurhash 字符串解码为一组用于 CSS 背景的属性。
 * @param hash - Blurhash 字符串, 例如 "LKO2?U%2Tw=w]~RBVZRi};RPxuwH"
 * @returns 一个包含多个 CSS 背景属性的对象
 */
export function blurhashToCss(hash: "undefined" | null | undefined): {};
export function blurhashToCss(hash: string): BlurhashCssProperties;
export function blurhashToCss(
  hash: string | "undefined" | null | undefined,
): BlurhashCssProperties | {} {
  if (!hash || hash.length < 6) {
    return {};
  }

  const sizeFlag = decode83(hash[0]);
  const numY = Math.floor(sizeFlag / 9) + 1;
  const numX = (sizeFlag % 9) + 1;

  const quantisedMaximumValue = decode83(hash[1]);
  const maximumValue = (quantisedMaximumValue + 1) / 166;

  const colors: [number, number, number][] = Array(numX * numY);

  // 解码 DC (平均色)
  const dcValue = decode83(hash.substring(2, 6));
  colors[0] = [dcValue >> 16, (dcValue >> 8) & 255, dcValue & 255];

  // 解码 AC (颜色分量)
  for (let i = 1; i < colors.length; i++) {
    const value = decode83(hash.substring(4 + i * 2, 6 + i * 2));
    colors[i] = [
      Math.floor(value / (19 * 19)),
      Math.floor(value / 19) % 19,
      value % 19,
    ];
  }

  const dc = colors[0];
  const ac = colors.slice(1);

  const backgroundImage: string[] = [];
  const backgroundPosition: string[] = [];
  const backgroundSize: string[] = [];

  // 处理 AC 分量，生成渐变层
  for (let j = 0; j < numY; j++) {
    for (let i = 0; i < numX; i++) {
      if (i === 0 && j === 0) continue; // 跳过 DC

      const basisX = Math.cos((Math.PI * i) / numX);
      const basisY = Math.cos((Math.PI * j) / numY);

      const [r, g, b] = ac[i - 1 + j * (numX - 1)];

      const colorR =
        srgbToLinear(dc[0]) +
        maximumValue * signPow((r - 9) / 9, 2.0) * basisX * basisY;
      const colorG =
        srgbToLinear(dc[1]) +
        maximumValue * signPow((g - 9) / 9, 2.0) * basisX * basisY;
      const colorB =
        srgbToLinear(dc[2]) +
        maximumValue * signPow((b - 9) / 9, 2.0) * basisX * basisY;

      const gradientColor = `rgb(${linearToSrgb(colorR)}, ${linearToSrgb(colorG)}, ${linearToSrgb(colorB)})`;

      // 每个 AC 分量都是一个覆盖整个区域的、从自身颜色到透明的径向渐变
      backgroundImage.push(
        `radial-gradient(circle, ${gradientColor} 0%, transparent 100%)`,
      );
      backgroundPosition.push(
        `${(i * 100) / (numX - 1)}% ${(j * 100) / (numY - 1)}%`,
      );
      backgroundSize.push(`${400 / numX}% ${400 / numY}%`);
    }
  }

  // 处理 DC 分量，作为最底层的纯色背景
  const [r, g, b] = dc;
  backgroundImage.push(`rgb(${r}, ${g}, ${b})`);
  backgroundPosition.push("0% 0%");
  backgroundSize.push("100% 100%");

  return {
    "background-image": backgroundImage.join(", "),
    "background-position": backgroundPosition.join(", "),
    "background-size": backgroundSize.join(", "),
    "background-repeat": "no-repeat",
  };
}
