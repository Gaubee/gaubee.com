/**
 * extract.ts 过滤逻辑测试（mock ImageData，不依赖真实 canvas）。
 * 验证：中性色过滤、极端亮度过滤、透明像素跳过、K-Means 集成。
 */
import { describe, expect, it } from "vitest";

import { rgbToOklch } from "./convert";
import { sampleToLchPoints } from "./extract";

/** 构造 mock ImageData（RGBA 字节数组）。 */
function mockImageData(pixels: Array<[number, number, number, number]>): { data: number[] } {
  const data: number[] = [];
  for (const [r, g, b, a] of pixels) {
    data.push(r, g, b, a);
  }
  return { data };
}

describe("sampleToLchPoints 过滤逻辑", () => {
  it("透明像素被跳过（alpha < 128）", () => {
    const img = mockImageData([
      [255, 0, 0, 255], // 不透明红
      [0, 255, 0, 0], // 完全透明绿（应跳过）
      [0, 0, 255, 50], // 半透明蓝（alpha<128，应跳过）
    ]);
    const points = sampleToLchPoints(img);
    expect(points.length).toBe(1); // 只有红
  });

  it("中性色被过滤（低彩度灰色）", () => {
    // 纯灰 RGB(128,128,128) 彩度极低
    const gray = rgbToOklch(128, 128, 128);
    expect(gray.C).toBeLessThan(0.05); // 确认是中性色
    const img = mockImageData([
      [128, 128, 128, 255], // 灰（应过滤）
      [200, 50, 30, 255], // 橙红（应保留）
    ]);
    const points = sampleToLchPoints(img);
    expect(points.length).toBe(1);
  });

  it("极端亮度被过滤（纯黑纯白）", () => {
    const img = mockImageData([
      [0, 0, 0, 255], // 纯黑（应过滤）
      [255, 255, 255, 255], // 纯白（应过滤）
      [200, 50, 30, 255], // 橙红（应保留）
    ]);
    const points = sampleToLchPoints(img);
    expect(points.length).toBe(1);
  });

  it("保留高彩度中等亮度的像素", () => {
    const img = mockImageData([
      [255, 0, 0, 255], // 红
      [0, 200, 0, 255], // 绿
      [0, 0, 255, 255], // 蓝
    ]);
    const points = sampleToLchPoints(img);
    expect(points.length).toBe(3);
  });

  it("空 ImageData 返回空数组", () => {
    const points = sampleToLchPoints({ data: [] });
    expect(points).toEqual([]);
  });
});
