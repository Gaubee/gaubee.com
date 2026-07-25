/**
 * 图片主色提取：canvas 采样 → K-Means 聚类。
 *
 * 正交意图：
 * 1. 原始需求（2026-07-24）：更换桌面背景图片时，从图片提取候选主题色供用户挑选。
 * 2. 2026-07-24 优化：从色相分桶改为 K-Means 聚类（LCH 三维空间），提升准确性。
 * 3. 2026-07-25 扩展：按彩度（C）分流提取双套候选——
 *    primary（高彩度品牌色）+ base（低彩度中性背景色）。
 *
 * 色彩学依据：base color 是图片的主导中性色调（低 C 占比大），
 * primary 是鲜艳强调色（高 C 占比小）。一次采样按 C 阈值分流，各自 K-Means。
 *
 * 无依赖，纯 canvas API。跨域图片需 CORS 头，否则 canvas tainted 导致 getImageData 抛错。
 */
import { rgbToOklch } from "./convert";
import { kmeans, type LchPoint } from "./kmeans";

/** 采样目标尺寸（缩放后采样，降低计算量）。 */
const SAMPLE_SIZE = 64;
/** 聚类簇数（略大于输出数，过滤空簇后取 top-N）。 */
const CLUSTER_K = 8;
/**
 * 彩度分流阈值（= 原 Primary 过滤的 MIN_CHROMA）。
 * - C ≥ 此值 → primary 候选（保持原 extractHuesFromImage 的过滤范围不变）。
 * - 0.005 ≤ C < 此值 → base 候选（低彩度中性色）。
 * - C < 0.005 → 纯灰丢弃（无主色价值）。
 */
const CHROMA_SPLIT = 0.05;
/** 极端亮度过滤：过暗/过亮像素不参与聚类。 */
const MIN_LIGHTNESS = 0.1;
const MAX_LIGHTNESS = 0.9;

/** 双旋钮提取结果。 */
export interface ExtractedThemeHues {
  /** primary 候选色相（高彩度品牌色），按频率降序。 */
  primary: number[];
  /** base 候选色相（低彩度中性色），按频率降序。 */
  base: number[];
}

/**
 * 从图片 URL 提取双套候选色相（primary + base）。
 *
 * @param url 图片 URL（需支持 CORS）
 * @param count 每套返回候选色数量（默认 5）
 * @returns { primary: number[], base: number[] }
 * @throws 图片加载失败或 canvas tainted（CORS 不允许）
 */
export async function extractThemeHues(url: string, count = 5): Promise<ExtractedThemeHues> {
  const imageData = await loadImageData(url);
  const { primaryPoints, basePoints } = sampleSplitByChroma(imageData);

  const primaryClusters = primaryPoints.length > 0 ? kmeans(primaryPoints, CLUSTER_K) : [];
  const baseClusters = basePoints.length > 0 ? kmeans(basePoints, CLUSTER_K) : [];

  return {
    primary: primaryClusters.slice(0, count).map((c) => c.centroid.H),
    base: baseClusters.slice(0, count).map((c) => c.centroid.H),
  };
}

/**
 * 从图片 URL 提取 primary 候选色相（兼容旧 API）。
 * @deprecated 优先用 extractThemeHues 获取双套候选。
 */
export async function extractHuesFromImage(url: string, count = 5): Promise<number[]> {
  const imageData = await loadImageData(url);
  const points = sampleToLchPoints(imageData);
  if (points.length === 0) return [];
  const clusters = kmeans(points, CLUSTER_K);
  return clusters.slice(0, count).map((c) => c.centroid.H);
}

/**
 * ImageData → LCH 采样点数组（过滤极端亮度 + 透明像素）。
 * 不过滤中性色（base 候选需要低 C 像素），由调用方按 C 分流。
 */
export function sampleToLchPoints(imageData: { data: Uint8ClampedArray | number[] }): LchPoint[] {
  const points: LchPoint[] = [];
  const { data } = imageData;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha < 128) continue;
    const { L, C, H } = rgbToOklch(data[i], data[i + 1], data[i + 2]);
    if (L < MIN_LIGHTNESS || L > MAX_LIGHTNESS) continue;
    points.push({ L, C, H });
  }
  return points;
}

/**
 * ImageData → 按 C（彩度）分流为 primary（高 C）+ base（低 C）两套采样点。
 * 导出供单测验证分流逻辑。
 */
export function sampleSplitByChroma(imageData: { data: Uint8ClampedArray | number[] }): {
  primaryPoints: LchPoint[];
  basePoints: LchPoint[];
} {
  const primaryPoints: LchPoint[] = [];
  const basePoints: LchPoint[] = [];
  const { data } = imageData;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha < 128) continue;
    const { L, C, H } = rgbToOklch(data[i], data[i + 1], data[i + 2]);
    if (L < MIN_LIGHTNESS || L > MAX_LIGHTNESS) continue;
    // C 极低（纯灰）丢弃，无主色价值（既非 primary 也非 base）
    if (C < 0.005) continue;
    if (C >= CHROMA_SPLIT) {
      primaryPoints.push({ L, C, H });
    } else {
      basePoints.push({ L, C, H });
    }
  }
  return { primaryPoints, basePoints };
}

/**
 * 加载图片并获取缩放后的 ImageData。
 * @throws 加载失败或 CORS 拒绝（canvas tainted）
 */
async function loadImageData(url: string): Promise<ImageData> {
  const img = await loadImage(url);
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("无法创建 canvas 2d 上下文");

  ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  return ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
}

/** 加载图片（crossOrigin=anonymous 必须，否则 getImageData tainted）。 */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`图片加载失败：${url}`));
    img.src = url;
  });
}
