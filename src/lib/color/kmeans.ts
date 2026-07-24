/**
 * K-Means 聚类（纯函数，可单测）。
 *
 * 正交意图：
 * 1. 原始需求（2026-07-24）：图片主色提取用 K-Means 替代色相分桶，提升准确性。
 *
 * 设计：
 * - 在 OKLCH 三维空间聚类（感知均匀，欧式距离近似感知差异）。
 * - hue 是环形量，两点间色相距离用最短弧长（避免 350° vs 10° 被算成 340° 距离）。
 * - C（彩度）参与距离计算（高彩度颜色优先成为簇代表）。
 * - 初始化用 K-Means++（簇中心分散，避免局部最优陷阱）。
 * - 簇按像素数排序（出现频率高的颜色优先输出）。
 */

/** 一个采样点（OKLCH 三维 + 权重）。 */
export interface LchPoint {
  L: number;
  C: number;
  H: number;
}

/** 聚类结果：簇中心 + 该簇像素数。 */
export interface LchCluster {
  centroid: LchPoint;
  count: number;
}

/** 两点间色相最短弧长（环形距离）。 */
function hueDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** OKLCH 加权欧式距离（L/C 线性，H 环形）。 */
export function lchDistance(a: LchPoint, b: LchPoint): number {
  const dL = a.L - b.L;
  const dC = a.C - b.C;
  const dH = hueDelta(a.H, b.H);
  return Math.sqrt(dL * dL + dC * dC + dH * dH);
}

/**
 * K-Means++ 初始化：首个中心随机选，后续中心选离已选中心越远的点（概率正比于距离²）。
 * 相比随机初始化，簇中心更分散，收敛更快更稳。
 */
function kmeansPlusPlusInit(points: LchPoint[], k: number): LchPoint[] {
  if (points.length === 0) return [];
  if (points.length <= k) return points.map((p) => ({ ...p }));

  const centers: LchPoint[] = [{ ...points[Math.floor(Math.random() * points.length)] }];

  while (centers.length < k) {
    // 每个点到最近中心的距离
    const dists = points.map((p) => {
      let min = Infinity;
      for (const c of centers) {
        const d = lchDistance(p, c);
        if (d < min) min = d;
      }
      return min * min; // 概率正比于距离²
    });
    const total = dists.reduce((s, d) => s + d, 0);
    if (total === 0) {
      // 所有点相同，随机补齐
      centers.push({ ...points[Math.floor(Math.random() * points.length)] });
      continue;
    }
    // 轮盘赌选下一个中心
    let r = Math.random() * total;
    for (let i = 0; i < points.length; i++) {
      r -= dists[i];
      if (r <= 0) {
        centers.push({ ...points[i] });
        break;
      }
    }
  }
  return centers;
}

/**
 * 对 OKLCH 采样点跑 K-Means 聚类。
 *
 * @param points 采样点（已过滤中性色等无价值像素）
 * @param k 簇数量（建议略大于最终输出数，如输出 5 个则 k=8）
 * @param maxIter 最大迭代次数（默认 12，LCH 空间收敛快）
 * @returns 簇数组，按像素数降序排序
 */
export function kmeans(points: LchPoint[], k: number, maxIter = 12): LchCluster[] {
  if (points.length === 0) return [];
  const effectiveK = Math.min(k, points.length);
  let centers = kmeansPlusPlusInit(points, effectiveK);

  for (let iter = 0; iter < maxIter; iter++) {
    // 分配：每个点归入最近中心
    const assignments = points.map((p) => {
      let nearest = 0;
      let minDist = Infinity;
      for (let i = 0; i < centers.length; i++) {
        const d = lchDistance(p, centers[i]);
        if (d < minDist) {
          minDist = d;
          nearest = i;
        }
      }
      return nearest;
    });

    // 更新：重新计算每个簇的中心（L/C 均值，H 用圆形均值避免边界跳变）
    const newCenters: LchPoint[] = [];
    let changed = false;
    for (let ci = 0; ci < centers.length; ci++) {
      const members = points.filter((_, pi) => assignments[pi] === ci);
      if (members.length === 0) {
        // 空簇：保留旧中心
        newCenters.push({ ...centers[ci] });
        continue;
      }
      const meanL = members.reduce((s, p) => s + p.L, 0) / members.length;
      const meanC = members.reduce((s, p) => s + p.C, 0) / members.length;
      const meanH = circularMean(members.map((p) => p.H));
      const newCenter = { L: meanL, C: meanC, H: meanH };
      if (lchDistance(newCenter, centers[ci]) > 0.001) changed = true;
      newCenters.push(newCenter);
    }

    centers = newCenters;
    if (!changed) break; // 收敛
  }

  // 统计每个簇的像素数，按数量降序排序
  return centers
    .map((centroid) => ({
      centroid,
      count: points.filter((p) => {
        let nearest = 0;
        let minDist = Infinity;
        for (let i = 0; i < centers.length; i++) {
          const d = lchDistance(p, centers[i]);
          if (d < minDist) {
            minDist = d;
            nearest = i;
          }
        }
        return centers[nearest] === centroid;
      }).length,
    }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);
}

/** 圆形均值（hue 环形，避免 350°+10° 算成 180°）。 */
function circularMean(hues: number[]): number {
  if (hues.length === 0) return 0;
  let sumSin = 0;
  let sumCos = 0;
  for (const h of hues) {
    const rad = (h * Math.PI) / 180;
    sumSin += Math.sin(rad);
    sumCos += Math.cos(rad);
  }
  let mean = (Math.atan2(sumSin, sumCos) * 180) / Math.PI;
  if (mean < 0) mean += 360;
  return mean;
}
