/**
 * RGB↔oklch 转换精度测试。
 * 参考值来自 OKLCH 规范与已知换算结果。
 */
import { describe, expect, it } from "vitest";

import { oklchToCss, rgbToOklch, rgbToHue } from "./convert";

describe("rgbToOklch", () => {
  it("纯白 → L≈1, C≈0", () => {
    const { L, C } = rgbToOklch(255, 255, 255);
    expect(L).toBeCloseTo(1, 2);
    expect(C).toBeLessThan(0.001);
  });

  it("纯黑 → L≈0", () => {
    const { L } = rgbToOklch(0, 0, 0);
    expect(L).toBeCloseTo(0, 2);
  });

  it("中灰 → L≈0.596", () => {
    const { L, C } = rgbToOklch(128, 128, 128);
    expect(L).toBeCloseTo(0.596, 1);
    expect(C).toBeLessThan(0.01);
  });

  it("纯红 → H 接近 29", () => {
    const { H } = rgbToOklch(255, 0, 0);
    expect(H).toBeGreaterThan(25);
    expect(H).toBeLessThan(31);
  });

  it("纯绿 → H 接近 142", () => {
    const { H } = rgbToOklch(0, 255, 0);
    expect(H).toBeGreaterThan(138);
    expect(H).toBeLessThan(146);
  });

  it("纯蓝 → H 接近 264", () => {
    const { H } = rgbToOklch(0, 0, 255);
    expect(H).toBeGreaterThan(260);
    expect(H).toBeLessThan(268);
  });

  it("橙红（默认 primary 近似）→ H 在红橙色相区间", () => {
    // oklch(0.514 0.222 16.935) 的近似 RGB，转换后 hue 落在 20-40 红橙区间
    const { H } = rgbToOklch(200, 50, 30);
    expect(H).toBeGreaterThan(20);
    expect(H).toBeLessThan(40);
  });

  it("色相范围 [0, 360)", () => {
    for (let r = 0; r <= 255; r += 64) {
      for (let g = 0; g <= 255; g += 64) {
        for (let b = 0; b <= 255; b += 64) {
          const { H } = rgbToOklch(r, g, b);
          expect(H).toBeGreaterThanOrEqual(0);
          expect(H).toBeLessThan(360);
        }
      }
    }
  });
});

describe("rgbToHue", () => {
  it("等于 rgbToOklch 的 H 分量", () => {
    expect(rgbToHue(255, 0, 0)).toBeCloseTo(rgbToOklch(255, 0, 0).H, 10);
    expect(rgbToHue(0, 200, 100)).toBeCloseTo(rgbToOklch(0, 200, 100).H, 10);
  });
});

describe("oklchToCss", () => {
  it("格式正确", () => {
    const css = oklchToCss({ L: 0.514, C: 0.222, H: 16.935 });
    expect(css).toBe("oklch(0.514 0.222 16.935)");
  });
});
