/**
 * 图片主色提取：canvas 采样 → RGB→oklch hue → 色相分桶统计。
 *
 * 正交意图：
 * 1. 原始需求（2026-07-24）：更换桌面背景图片时，从图片提取候选主题色供用户挑选。
 *
 * 设计：
 * - 无依赖，纯 canvas API。跨域图片需 CORS 头，否则 canvas tainted 导致 getImageData 抛错。
 * - 下采样：图片缩放到 64x64 采样（足够统计主色，避免全像素扫描开销）。
 * - 色相分桶：每 12° 一桶（30 桶覆盖 360°），桶内取 hue 中位数，按像素数降序取 top-N。
 * - 过滤：跳过过暗（L<0.1）和过亮（L>0.9）的像素（避免黑白干扰主色）。
 */
import { rgbToOklch } from "./convert";

/** 桶宽（度）。12° → 30 桶，粒度适中。 */
const BUCKET_WIDTH = 12;
const BUCKET_COUNT = Math.round(360 / BUCKET_WIDTH);

/** 采样目标尺寸（缩放后采样，降低计算量）。 */
const SAMPLE_SIZE = 64;

/**
 * 从图片 URL 提取候选色相。
 *
 * @param url 图片 URL（需支持 CORS）
 * @param count 返回候选色数量（默认 5）
 * @returns 候选色相数组 [0, 360)，像素频率降序
 * @throws 图片加载失败或 canvas tainted（CORS 不允许）
 */
export async function extractHuesFromImage(url: string, count = 5): Promise<number[]> {
  const imageData = await loadImageData(url);
  const buckets = new Array(BUCKET_COUNT).fill(null).map(() => ({ sum: 0, count: 0 }));

  // 遍历采样像素，统计色相分桶
  for (let i = 0; i < imageData.data.length; i += 4) {
    const r = imageData.data[i];
    const g = imageData.data[i + 1];
    const b = imageData.data[i + 2];
    const alpha = imageData.data[i + 3];
    if (alpha < 128) continue; // 跳过透明像素

    const { L, H } = rgbToOklch(r, g, b);
    // 跳过过暗/过亮像素（黑白灰无主色价值）
    if (L < 0.1 || L > 0.9) continue;

    const bucketIdx = Math.floor(H / BUCKET_WIDTH) % BUCKET_COUNT;
    buckets[bucketIdx].sum += H;
    buckets[bucketIdx].count += 1;
  }

  // 按像素数降序，取每个桶的 hue 均值
  const sorted = buckets
    .filter((b) => b.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, count)
    .map((b) => b.sum / b.count);

  return sorted;
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
