/**
 * K-Means 聚类纯函数测试。
 * 验证：环形色相距离、K-Means++ 初始化、聚类收敛、簇排序。
 */
import { describe, expect, it } from "vitest";

import { kmeans, lchDistance, type LchPoint } from "./kmeans";

describe("lchDistance", () => {
  it("相同点距离为 0", () => {
    const p: LchPoint = { L: 0.5, C: 0.2, H: 30 };
    expect(lchDistance(p, p)).toBe(0);
  });

  it("纯亮度差", () => {
    const a: LchPoint = { L: 0.3, C: 0.2, H: 30 };
    const b: LchPoint = { L: 0.7, C: 0.2, H: 30 };
    expect(lchDistance(a, b)).toBeCloseTo(0.4, 5);
  });

  it("色相环形距离：350° 与 10° 应为 20°（非 340°）", () => {
    const a: LchPoint = { L: 0.5, C: 0.2, H: 350 };
    const b: LchPoint = { L: 0.5, C: 0.2, H: 10 };
    // dH = 20，dL=dC=0，距离 = 20
    expect(lchDistance(a, b)).toBeCloseTo(20, 5);
  });

  it("色相环形距离：0° 与 180° 应为 180°", () => {
    const a: LchPoint = { L: 0.5, C: 0.2, H: 0 };
    const b: LchPoint = { L: 0.5, C: 0.2, H: 180 };
    expect(lchDistance(a, b)).toBeCloseTo(180, 5);
  });
});

describe("kmeans", () => {
  it("空数组返回空簇", () => {
    expect(kmeans([], 3)).toEqual([]);
  });

  it("点数 ≤ k 时每个点自成簇", () => {
    const points: LchPoint[] = [
      { L: 0.5, C: 0.2, H: 10 },
      { L: 0.5, C: 0.2, H: 200 },
    ];
    const clusters = kmeans(points, 5);
    expect(clusters.length).toBe(2);
  });

  it("两组明显分离的点应聚成两个簇", () => {
    // 红色组（hue 0-20）和蓝色组（hue 240-260）
    const reds: LchPoint[] = Array.from({ length: 20 }, (_, i) => ({
      L: 0.5,
      C: 0.2,
      H: 10 + i,
    }));
    const blues: LchPoint[] = Array.from({ length: 20 }, (_, i) => ({
      L: 0.5,
      C: 0.2,
      H: 250 + i,
    }));
    const clusters = kmeans([...reds, ...blues], 2);
    expect(clusters.length).toBe(2);
    // 两个簇的 hue 应分别落在红色区和蓝色区
    const hues = clusters.map((c) => c.centroid.H).sort((a, b) => a - b);
    expect(hues[0]).toBeLessThan(60); // 红色区
    expect(hues[1]).toBeGreaterThan(200); // 蓝色区
    // 每个簇应有约 20 个点
    expect(clusters[0].count).toBeGreaterThanOrEqual(15);
    expect(clusters[1].count).toBeGreaterThanOrEqual(15);
  });

  it("结果按簇大小降序排序", () => {
    // 30 个红 + 10 个蓝，红色簇应排第一
    const reds: LchPoint[] = Array.from({ length: 30 }, () => ({
      L: 0.5,
      C: 0.2,
      H: 15,
    }));
    const blues: LchPoint[] = Array.from({ length: 10 }, () => ({
      L: 0.5,
      C: 0.2,
      H: 250,
    }));
    const clusters = kmeans([...reds, ...blues], 2);
    expect(clusters.length).toBe(2);
    expect(clusters[0].count).toBeGreaterThanOrEqual(clusters[1].count);
    // 第一簇（大簇）应是红色
    expect(clusters[0].centroid.H).toBeLessThan(60);
  });

  it("k=1 时所有点归一簇", () => {
    const points: LchPoint[] = [
      { L: 0.4, C: 0.2, H: 10 },
      { L: 0.6, C: 0.2, H: 30 },
      { L: 0.5, C: 0.2, H: 20 },
    ];
    const clusters = kmeans(points, 1);
    expect(clusters.length).toBe(1);
    expect(clusters[0].count).toBe(3);
    // 质心 L 均值 = 0.5
    expect(clusters[0].centroid.L).toBeCloseTo(0.5, 3);
  });

  it("色相边界聚类：350° 和 10° 应聚到同一簇（环形距离近）", () => {
    const points: LchPoint[] = [
      ...Array.from({ length: 10 }, () => ({ L: 0.5, C: 0.2, H: 350 })),
      ...Array.from({ length: 10 }, () => ({ L: 0.5, C: 0.2, H: 10 })),
      ...Array.from({ length: 10 }, () => ({ L: 0.5, C: 0.2, H: 180 })),
    ];
    const clusters = kmeans(points, 2);
    expect(clusters.length).toBe(2);
    // 应有一个簇的质心在红橙边界（0° 附近），另一个在 180°
    const hues = clusters.map((c) => c.centroid.H).sort((a, b) => a - b);
    // 红橙簇（350+10 合并）质心应在 0° 或 360° 附近
    const redCluster = hues.find((h) => h < 30 || h > 330);
    expect(redCluster).toBeDefined();
  });
});
