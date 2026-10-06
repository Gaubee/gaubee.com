import { describe, expect, it } from "vitest";

import { containerPaths, flattenJsonTree, pathKey, visibleRange } from "./virtual-tree";

const value = { users: [{ name: "Ada" }, { name: "Grace" }], count: 2 };

describe("flattenJsonTree", () => {
  it("只展开 openPaths 中的容器并保持深度优先顺序", () => {
    const rows = flattenJsonTree(value, new Set([pathKey([]), pathKey(["users"])]));
    expect(rows.map((row) => [row.name, row.depth])).toEqual([
      [null, 0],
      ["users", 1],
      ["0", 2],
      ["1", 2],
      ["count", 1],
    ]);
  });

  it("收集容器路径供全展开", () => {
    expect(containerPaths(value)).toEqual(["[]", '["users"]', '["users",0]', '["users",1]']);
  });
});

describe("visibleRange", () => {
  it("返回带 overscan 的行区间和总高度", () => {
    expect(visibleRange(1000, 2600, 260, 26, 2)).toEqual({
      start: 98,
      end: 112,
      offsetTop: 2548,
      totalHeight: 26000,
    });
  });

  it("边界不超出总行数", () => {
    expect(visibleRange(3, 0, 100)).toEqual({ start: 0, end: 3, offsetTop: 0, totalHeight: 78 });
  });
});
