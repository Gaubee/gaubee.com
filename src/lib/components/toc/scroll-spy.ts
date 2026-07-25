/**
 * ScrollSpy 核心纯算法 —— AST 范围推断 + 交集比例映射。
 *
 * 正交意图：
 * 1. 原始需求（2026-07-26）：通用 ToC 滚动高亮，需支持 markdown heading 与
 *    任意结构化内容（如文章按年份分组）。强度按"范围与 viewport 交集比例"渐变。
 * 2. 节点定义采用 AST 式遍历范式：caller 提供 detector 在容器内识别节点，
 *    本算法基于"节点序列 + depth"推断每个节点的范围边界。
 *
 * 设计原则：本文件**不含任何 DOM 依赖**——所有几何/遍历输入由 caller 提供。
 * 这样核心逻辑在 node 环境可直接单测；DOM 适配（Range、scroll 事件、
 * MutationObserver）见 scroll-spy.dom.ts。
 *
 * 范围边界规则：
 *   给定按 DOM 顺序排列的节点序列 N₀, N₁, ..., Nₖ，节点 Nᵢ 的范围 = [Nᵢ, NextSibling(Nᵢ))
 *   其中 NextSibling(Nᵢ) = 序列中第一个 depth(Nⱼ) ≤ depth(Nᵢ) 且 j > i 的节点；
 *   若不存在则范围为 [Nᵢ, 容器末尾]（endElement = null）。
 *   依据：下一同级或更高级节点的出现，标志当前节点内容叙述的结束。
 */

/**
 * ToC 节点（AST 形态）—— caller 通过遍历容器 + detector 得到此序列。
 * 泛型 E：承载节点的元素类型（DOM 适配层用 HTMLElement，测试可用更轻的类型）。
 */
export interface SpyNode<E> {
  /** 稳定 id（ToC button key + 跳转锚点）。 */
  id: string;
  /** 层级：数字越小级别越高（h2=2, h3=3；年份 section=2）。 */
  depth: number;
  /** 范围起点元素（含）。 */
  startElement: E;
  /**
   * 范围终点元素（不含）。
   * - 算法填入：序列中下一个 depth ≤ 自身的节点的 startElement
   * - null：表示范围延伸到容器末尾（无更高级或同级后续节点）
   */
  endElement: E | null;
}

/**
 * 给定按 DOM 顺序排列的节点描述（仅 id/depth/startElement），原地填充 endElement。
 *
 * @param nodes 按 DOM 顺序排列的节点（caller 已排序）
 * @returns 同一数组（endElement 已填好），便于链式调用
 *
 * 算法：对每个 i，向后找第一个 j>i 满足 nodes[j].depth <= nodes[i].depth。
 * 找到 → endElement = nodes[j].startElement；否则 endElement = null。
 *
 * 复杂度 O(n²) 对长文档可能慢——若实测有性能问题可改用单调栈优化为 O(n)。
 * 当前 ToC 节点数通常 < 100，O(n²) 完全够用。
 */
export function computeNodeRanges<E>(nodes: SpyNode<E>[]): SpyNode<E>[] {
  for (let i = 0; i < nodes.length; i++) {
    const currentDepth = nodes[i].depth;
    let endElement: E | null = null;
    for (let j = i + 1; j < nodes.length; j++) {
      if (nodes[j].depth <= currentDepth) {
        endElement = nodes[j].startElement;
        break;
      }
    }
    nodes[i].endElement = endElement;
  }
  return nodes;
}

/**
 * 几何矩形（与 DOMRect 同构，但解耦自浏览器 API，便于测试）。
 * 坐标系与 viewport/rects 一致（caller 保证）。
 */
export interface Rect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** 矩形面积（仅取正宽高）。 */
function area(r: Rect): number {
  return Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);
}

/** 两个矩形的交集矩形（无交集返回 null）。 */
function intersect(a: Rect, b: Rect): Rect | null {
  const top = Math.max(a.top, b.top);
  const bottom = Math.min(a.bottom, b.bottom);
  const left = Math.max(a.left, b.left);
  const right = Math.min(a.right, b.right);
  if (bottom <= top || right <= left) return null;
  return { top, bottom, left, right };
}

/**
 * 交集比例映射规则（用户需求 2026-07-26）：
 * - 范围包含 viewport（节点范围比 viewport 大，且完全覆盖 viewport） → 1.0
 * - viewport 包含范围（节点范围完全在 viewport 内） → 1.0
 * - 部分 overlap（节点与 viewport 边界相交但都不互相包含） → 交集面积 / viewport 面积
 *
 * 实现要点：
 * - "viewport 包含范围" 用"节点面积 == 交集面积"判定（节点的所有矩形都被 viewport 覆盖）
 * - "范围包含 viewport" 用"交集面积 == viewport 面积"判定（viewport 被节点完全覆盖）
 * - 否则按 交集/viewport 反映"视野在节点内的滑动占比"
 *
 * 基准选 viewport 而非节点：长节点在视野滚动时高亮随视野占比平滑变化（符合阅读直觉），
 * 小节点一旦进入视野就 100%（避免小标题滚过时高亮闪烁）。
 */
export function computeHighlightRatio(nodeRects: Rect[], viewport: Rect): number {
  const viewportArea = area(viewport);
  if (viewportArea <= 0) return 0;

  let intersectArea = 0;
  let nodeArea = 0;
  for (const r of nodeRects) {
    nodeArea += area(r);
    const x = intersect(r, viewport);
    if (x) intersectArea += area(x);
  }

  // 无交集 → 0
  if (intersectArea <= 0) return 0;

  // viewport 包含范围：节点完全可见 → 100%
  if (intersectArea >= nodeArea) return 1;

  // 范围包含 viewport：viewport 被完全覆盖 → 100%
  if (intersectArea >= viewportArea) return 1;

  // 部分 overlap：交集/viewport
  return intersectArea / viewportArea;
}

/**
 * 基于当前节点集合 + 各节点的 rects + viewport，计算完整高亮映射。
 *
 * @param nodes 已填好 startElement/endElement 的节点序列
 * @param getRects 接收 (start, end) 返回该范围的所有矩形（caller 用 Range.getClientRects 实现）
 * @param viewport 当前 viewport 矩形
 * @returns Map<nodeId, ratio 0~1>
 */
export function computeHighlightMap<E>(
  nodes: SpyNode<E>[],
  getRects: (start: E, end: E | null) => Rect[],
  viewport: Rect,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const node of nodes) {
    const rects = getRects(node.startElement, node.endElement);
    map.set(node.id, computeHighlightRatio(rects, viewport));
  }
  return map;
}

/**
 * 增量 AST 更新：DOM 变动后，重新计算受影响节点的范围。
 *
 * 设计（用户要求："上方的节点结果可以保持不变"）：
 * - 变动前保留的节点序列中，从"第一个受影响位置"开始向后的所有节点 endElement 重算。
 * - "受影响位置"由 caller 通过 changedFromIndex 指明（通常 = MutationObserver
 *   找到的第一个变动节点在序列中的位置）。
 * - 0..changedFromIndex-1 的节点不变。
 *
 * @param nodes 节点序列（含未变动的头部 + 已重新填充的尾部）
 * @param changedFromIndex 从该 index（含）开始重算 endElement
 */
export function recomputeRangesFrom<E>(nodes: SpyNode<E>[], changedFromIndex: number): void {
  if (changedFromIndex < 0) changedFromIndex = 0;
  for (let i = changedFromIndex; i < nodes.length; i++) {
    const currentDepth = nodes[i].depth;
    let endElement: E | null = null;
    for (let j = i + 1; j < nodes.length; j++) {
      if (nodes[j].depth <= currentDepth) {
        endElement = nodes[j].startElement;
        break;
      }
    }
    nodes[i].endElement = endElement;
  }
}

/** 交集矩形工具导出（测试用）。 */
export const __testing = { intersect, area };
