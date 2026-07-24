/**
 * 图片主色提取：canvas 采样 → K-Means 聚类。
 *
 * 正交意图：
 * 1. 原始需求（2026-07-24）：更换桌面背景图片时，从图片提取候选主题色供用户挑选。
 * 2. 2026-07-24 优化：从色相分桶改为 K-Means 聚类（LCH 三维空间），提升准确性。
 *
 * 改进点（相比色相分桶）：
 * - K-Means 在 OKLCH 三维空间聚类，感知均匀，能区分"亮红"和"暗红"。
 * - 严格过滤中性色（C < 0.05 的灰色直接丢弃），避免灰调淹没主色。
 * - 簇代表色是质心而非桶均值，无边界模糊问题。
 * - hue 用圆形均值，避免 350°+10° 被算成 180°。
 *
 * 无依赖，纯 canvas API。跨域图片需 CORS 头，否则 canvas tainted 导致 getImageData 抛错。
 */
import { rgbToOklch } from "./convert";
import { kmeans, type LchPoint } from "./kmeans";

/** 采样目标尺寸（缩放后采样，降低计算量）。 */
const SAMPLE_SIZE = 64;
/** 聚类簇数（略大于输出数，过滤空簇后取 top-N）。 */
const CLUSTER_K = 8;
/** 中性色过滤阈值：彩度低于此值视为灰色，不参与聚类。 */
const MIN_CHROMA = 0.05;
/** 极端亮度过滤：过暗/过亮像素不参与聚类。 */
const MIN_LIGHTNESS = 0.1;
const MAX_LIGHTNESS = 0.9;

/**
 * 从图片 URL 提取候选色相。
 *
 * @param url 图片 URL（需支持 CORS）
 * @param count 返回候选色数量（默认 5）
 * @returns 候选色相数组 [0, 360)，按簇像素数（出现频率）降序
 * @throws 图片加载失败或 canvas tainted（CORS 不允许）
 */
export async function extractHuesFromImage(url: string, count = 5): Promise<number[]> {
  const imageData = await loadImageData(url);
  const points = sampleToLchPoints(imageData);
  if (points.length === 0) return [];

  const clusters = kmeans(points, CLUSTER_K);
  return clusters.slice(0, count).map((c) => c.centroid.H);
}

/**
 * ImageData → LCH 采样点数组（过滤中性色 + 极端亮度）。
 * 导出供单测验证过滤逻辑（无需真实 canvas）。
 */
export function sampleToLchPoints(imageData: { data: Uint8ClampedArray | number[] }): LchPoint[] {
  const points: LchPoint[] = [];
  const { data } = imageData;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha < 128) continue; // 跳过透明像素

    const { L, C, H } = rgbToOklch(data[i], data[i + 1], data[i + 2]);
    // 过滤：极端亮度（纯黑/纯白）+ 中性色（灰色无主色价值）
    if (L < MIN_LIGHTNESS || L > MAX_LIGHTNESS) continue;
    if (C < MIN_CHROMA) continue;

    points.push({ L, C, H });
  }
  return points;
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
  // tainted canvas 会抛 SecurityError
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
