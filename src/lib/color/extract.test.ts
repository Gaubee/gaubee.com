/**
 * extract.ts 过滤/分流逻辑测试（mock ImageData，不依赖真实 canvas）。
 * 验证：极端亮度过滤、透明像素跳过、按彩度分流 primary/base。
 */
import { describe, expect, it } from "vitest";

import { rgbToOklch } from "./convert";
import { sampleSplitByChroma, sampleToLchPoints } from "./extract";

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

  it("极端亮度被过滤（纯黑纯白）", () => {
    const img = mockImageData([
      [0, 0, 0, 255], // 纯黑（应过滤）
      [255, 255, 255, 255], // 纯白（应过滤）
      [200, 50, 30, 255], // 橙红（应保留）
    ]);
    const points = sampleToLchPoints(img);
    expect(points.length).toBe(1);
  });

  it("保留中等亮度的像素（含低彩度，分流由 sampleSplitByChroma 处理）", () => {
    const img = mockImageData([
      [255, 0, 0, 255], // 红（高 C）
      [128, 128, 140, 255], // 灰蓝（低 C）
    ]);
    const points = sampleToLchPoints(img);
    expect(points.length).toBe(2); // 两者都保留
  });

  it("空 ImageData 返回空数组", () => {
    const points = sampleToLchPoints({ data: [] });
    expect(points).toEqual([]);
  });
});

describe("sampleSplitByChroma 按彩度分流", () => {
  it("高彩度像素归 primary，低彩度归 base", () => {
    const red = rgbToOklch(255, 0, 0);
    expect(red.C).toBeGreaterThan(0.08); // 确认是高彩度
    const gray = rgbToOklch(128, 128, 140);
    expect(gray.C).toBeLessThan(0.08); // 确认是低彩度

    const img = mockImageData([
      [255, 0, 0, 255], // 红（高 C → primary）
      [128, 128, 140, 255], // 灰蓝（低 C → base）
    ]);
    const { primaryPoints, basePoints } = sampleSplitByChroma(img);
    expect(primaryPoints.length).toBe(1);
    expect(basePoints.length).toBe(1);
  });

  it("纯灰（C<0.005）被完全丢弃", () => {
    const pureGray = rgbToOklch(128, 128, 128);
    expect(pureGray.C).toBeLessThan(0.005);
    const img = mockImageData([
      [128, 128, 128, 255], // 纯灰（应丢弃）
      [200, 50, 30, 255], // 橙红（→ primary）
    ]);
    const { primaryPoints, basePoints } = sampleSplitByChroma(img);
    expect(primaryPoints.length).toBe(1);
    expect(basePoints.length).toBe(0);
  });

  it("所有像素高彩度时 base 为空", () => {
    const img = mockImageData([
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
    ]);
    const { primaryPoints, basePoints } = sampleSplitByChroma(img);
    expect(primaryPoints.length).toBe(3);
    expect(basePoints.length).toBe(0);
  });
});
