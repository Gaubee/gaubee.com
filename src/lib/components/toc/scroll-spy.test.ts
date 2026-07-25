/**
 * ScrollSpy 核心纯算法单元测试。
 *
 * 覆盖：
 * - computeNodeRanges：AST 范围推断（同级、嵌套、单节点、空）
 * - computeHighlightRatio / computeHighlightMap：交集比例映射（包含/被包含/部分 overlap）
 * - recomputeRangesFrom：增量重算（头部保留、尾部更新）
 *
 * 全部用伪造的元素对象（{ tag: 'n0' } 之类）作为 E，零 DOM 依赖。
 */
import { describe, expect, it } from "vitest";

import {
  computeHighlightMap,
  computeHighlightRatio,
  computeNodeRanges,
  recomputeRangesFrom,
  __testing,
  type Rect,
  type SpyNode,
} from "./scroll-spy";

// 用字符串作为元素标识，方便测试中引用。
type FakeEl = { tag: string };
const el = (tag: string): FakeEl => ({ tag });

function makeNode(id: string, depth: number, tag: string): SpyNode<FakeEl> {
  return { id, depth, startElement: el(tag), endElement: null };
}

describe("computeNodeRanges", () => {
  it("空数组返回空", () => {
    expect(computeNodeRanges([])).toEqual([]);
  });

  it("单节点 endElement=null（延伸到容器末尾）", () => {
    const nodes = computeNodeRanges([makeNode("a", 2, "a")]);
    expect(nodes[0].endElement).toBeNull();
  });

  it("同级节点：每个的终点是下一个同级节点", () => {
    const nodes = computeNodeRanges([
      makeNode("y2024", 2, "y2024"),
      makeNode("y2023", 2, "y2023"),
      makeNode("y2022", 2, "y2022"),
    ]);
    expect(nodes[0].endElement?.tag).toBe("y2023");
    expect(nodes[1].endElement?.tag).toBe("y2022");
    expect(nodes[2].endElement).toBeNull();
  });

  it("嵌套层级：h2 之间夹 h3，h2 终点仍是下一个 h2", () => {
    // 模拟 markdown：h2 / h3 / h3 / h2 / h3
    const nodes = computeNodeRanges([
      makeNode("h2-a", 2, "a"),
      makeNode("h3-a1", 3, "a1"),
      makeNode("h3-a2", 3, "a2"),
      makeNode("h2-b", 2, "b"),
      makeNode("h3-b1", 3, "b1"),
    ]);
    expect(nodes[0].endElement?.tag).toBe("b"); // h2-a 终于 h2-b
    expect(nodes[1].endElement?.tag).toBe("a2"); // h3-a1 终于下一个同级 h3
    expect(nodes[2].endElement?.tag).toBe("b"); // h3-a2 终于更高级 h2-b（depth<=3）
    expect(nodes[3].endElement).toBeNull(); // h2-b 是最后一个 depth<=2
    expect(nodes[4].endElement).toBeNull();
  });

  it("depth=1 高级别节点：其范围内所有更深节点都是它的子范围", () => {
    const nodes = computeNodeRanges([
      makeNode("root", 1, "root"),
      makeNode("child", 2, "child"),
      makeNode("sibling", 1, "sibling"),
    ]);
    expect(nodes[0].endElement?.tag).toBe("sibling"); // root 终于下一个 depth<=1
    expect(nodes[1].endElement?.tag).toBe("sibling"); // child 也终于 sibling（depth<=2）
    expect(nodes[2].endElement).toBeNull();
  });
});

describe("computeHighlightRatio", () => {
  const viewport: Rect = { top: 0, bottom: 100, left: 0, right: 100 };

  it("viewport 面积为 0 返回 0", () => {
    const zero: Rect = { top: 0, bottom: 0, left: 0, right: 100 };
    expect(computeHighlightRatio([viewport], zero)).toBe(0);
  });

  it("范围包含 viewport（节点更大且覆盖）→ 1.0", () => {
    const big: Rect = { top: -50, bottom: 200, left: 0, right: 100 };
    expect(computeHighlightRatio([big], viewport)).toBe(1);
  });

  it("viewport 包含范围（节点更小且完全在视野内）→ 1.0（用户规则：viewport 包含范围=100%）", () => {
    const small: Rect = { top: 10, bottom: 20, left: 10, right: 20 };
    expect(computeHighlightRatio([small], viewport)).toBe(1);
  });

  it("部分 overlap：交集面积/viewport 面积", () => {
    const partial: Rect = { top: 50, bottom: 150, left: 0, right: 100 };
    // 交集：top=50, bottom=100, area=50*100=5000；viewport area=10000；ratio=0.5
    expect(computeHighlightRatio([partial], viewport)).toBe(0.5);
  });

  it("无交集返回 0", () => {
    const off: Rect = { top: 200, bottom: 300, left: 0, right: 100 };
    expect(computeHighlightRatio([off], viewport)).toBe(0);
  });

  it("多个矩形求和（跨节点 Range 的多 ClientRect）", () => {
    // 两个各占 viewport 一半面积的矩形，不重叠 → 总和 = 1.0
    const r1: Rect = { top: 0, bottom: 50, left: 0, right: 100 };
    const r2: Rect = { top: 50, bottom: 100, left: 0, right: 100 };
    expect(computeHighlightRatio([r1, r2], viewport)).toBe(1);
  });
});

describe("computeHighlightMap", () => {
  it("对每个节点调用 getRects 并映射比例", () => {
    const viewport: Rect = { top: 0, bottom: 100, left: 0, right: 100 };
    const nodes = computeNodeRanges([makeNode("a", 2, "a"), makeNode("b", 2, "b")]);
    // mock getRects：a 高度 50 完全在 viewport 内（top=0..50）→ viewport 包含范围 → 1.0
    //                b 高度 50 完全在 viewport 内（top=50..100）→ 1.0
    const getRects = (start: FakeEl, _end: FakeEl | null): Rect[] => {
      if (start.tag === "a") return [{ top: 0, bottom: 50, left: 0, right: 100 }];
      return [{ top: 50, bottom: 100, left: 0, right: 100 }];
    };
    const map = computeHighlightMap(nodes, getRects, viewport);
    expect(map.get("a")).toBe(1);
    expect(map.get("b")).toBe(1);
  });

  it("部分 overlap 的节点得到中间比例", () => {
    const viewport: Rect = { top: 0, bottom: 100, left: 0, right: 100 };
    const nodes = computeNodeRanges([makeNode("a", 2, "a")]);
    // a 范围 top=50..150，节点面积=100×100=10000，交集=50×100=5000
    // 既不"完全包含"也不"完全被包含"→ 部分 overlap → 5000/10000 = 0.5
    const getRects = (): Rect[] => [{ top: 50, bottom: 150, left: 0, right: 100 }];
    const map = computeHighlightMap(nodes, getRects, viewport);
    expect(map.get("a")).toBe(0.5);
  });

  it("空节点序列返回空 Map", () => {
    expect(computeHighlightMap([], () => [], { top: 0, bottom: 1, left: 0, right: 1 }).size).toBe(
      0,
    );
  });
});

describe("recomputeRangesFrom", () => {
  it("changedFromIndex 之前的节点不变", () => {
    const nodes = computeNodeRanges([
      makeNode("a", 2, "a"),
      makeNode("b", 2, "b"),
      makeNode("c", 2, "c"),
    ]);
    // 保存 a 的 endElement
    const aEnd = nodes[0].endElement;
    // 模拟：插入新节点 x 在 b 之后，重算从 index=1 开始
    nodes.splice(2, 0, makeNode("x", 2, "x"));
    recomputeRangesFrom(nodes, 1);
    expect(nodes[0].endElement).toBe(aEnd); // a 不变
    // b（index 1）的终点现在是 x
    expect(nodes[1].endElement?.tag).toBe("x");
    // x 的终点是 c
    expect(nodes[2].endElement?.tag).toBe("c");
  });

  it("changedFromIndex < 0 视为 0（全部重算）", () => {
    const nodes: SpyNode<FakeEl>[] = [makeNode("a", 2, "a"), makeNode("b", 2, "b")];
    nodes[0].endElement = el("wrong");
    recomputeRangesFrom(nodes, -5);
    expect(nodes[0].endElement?.tag).toBe("b");
  });
});

describe("__testing 几何工具", () => {
  it("intersect 无交集返回 null", () => {
    expect(
      __testing.intersect(
        { top: 0, bottom: 10, left: 0, right: 10 },
        { top: 20, bottom: 30, left: 0, right: 10 },
      ),
    ).toBeNull();
  });

  it("area 负宽高返回 0", () => {
    expect(__testing.area({ top: 10, bottom: 5, left: 0, right: 10 })).toBe(0);
  });
});
