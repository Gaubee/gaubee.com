/**
 * label-color 单测：hex 解析 + 亮度计算 + 样式派生。
 */
import { describe, expect, it } from "vitest";

import { deriveLabelStyle, hexToRgb, labelStyleString } from "./label-color";

describe("hexToRgb", () => {
  it("6 位 hex", () => {
    expect(hexToRgb("d73a4a")).toEqual([0xd7, 0x3a, 0x4a]);
  });

  it("带 # 前缀", () => {
    expect(hexToRgb("#d73a4a")).toEqual([0xd7, 0x3a, 0x4a]);
  });

  it("3 位 hex（缩写）", () => {
    expect(hexToRgb("fff")).toEqual([255, 255, 255]);
    expect(hexToRgb("#000")).toEqual([0, 0, 0]);
  });

  it("无效输入返回 null", () => {
    expect(hexToRgb("xyz")).toBeNull();
    expect(hexToRgb("")).toBeNull();
    expect(hexToRgb("#12345")).toBeNull(); // 5 位
  });
});

describe("deriveLabelStyle - 前景文字亮度自适应", () => {
  it("浅色背景 → 深色文字", () => {
    // 白色背景（亮度最高）
    const s = deriveLabelStyle("ffffff");
    expect(s.color).toBe("#1f2328"); // 深色文字
    expect(s.backgroundColor).toBe("rgb(255, 255, 255)");
  });

  it("深色背景 → 浅色文字", () => {
    // 黑色背景（亮度最低）
    const s = deriveLabelStyle("000000");
    expect(s.color).toBe("#ffffff"); // 白色文字
    expect(s.backgroundColor).toBe("rgb(0, 0, 0)");
  });

  it("GitHub 常见 label 颜色（红色 bug label）", () => {
    // d73a4a 是 GitHub 经典的 bug 红色
    const s = deriveLabelStyle("d73a4a");
    expect(s.color).toBe("#ffffff"); // 深红背景 → 白字
    expect(s.backgroundColor).toBe("rgb(215, 58, 74)");
  });

  it("GitHub 淡蓝色 label（awaiting submitter）", () => {
    // c5def5 淡蓝
    const s = deriveLabelStyle("c5def5");
    expect(s.color).toBe("#1f2328"); // 浅蓝背景 → 深字
    expect(s.backgroundColor).toBe("rgb(197, 222, 245)");
  });

  it("无效颜色 → 灰色默认值", () => {
    const s = deriveLabelStyle("not-a-color");
    expect(s.color).toBe("var(--foreground)");
    expect(s.backgroundColor).toBe("var(--muted)");
  });

  it("边框是半透明同色", () => {
    const s = deriveLabelStyle("d73a4a");
    expect(s.borderColor).toMatch(/rgba\(215, 58, 74, 0\.6\)/);
  });
});

describe("labelStyleString", () => {
  it("生成 inline style 字符串", () => {
    const str = labelStyleString("d73a4a");
    expect(str).toContain("color: #ffffff");
    expect(str).toContain("background-color: rgb(215, 58, 74)");
    expect(str).toContain("border-color: rgba(215, 58, 74, 0.6)");
  });
});
