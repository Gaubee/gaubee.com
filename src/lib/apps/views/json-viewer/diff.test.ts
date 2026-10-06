import { describe, expect, it } from "vitest";

import { diffJson } from "./diff";

describe("diffJson", () => {
  it("报告对象新增、删除和修改", () => {
    const result = diffJson(
      { keep: 1, rename: "old", removed: true },
      { keep: 1, rename: "new", added: 2 },
    );
    expect(result).toEqual([
      { path: ["added"], pathText: "$.added", kind: "added", before: undefined, after: 2 },
      { path: ["removed"], pathText: "$.removed", kind: "removed", before: true, after: undefined },
      { path: ["rename"], pathText: "$.rename", kind: "changed", before: "old", after: "new" },
    ]);
  });

  it("递归比较数组并保留下标路径", () => {
    const result = diffJson(["same", { count: 1 }, 3], ["same", { count: 2 }]);
    expect(result.map((entry) => [entry.pathText, entry.kind, entry.before, entry.after])).toEqual([
      ["$[1].count", "changed", 1, 2],
      ["$[2]", "removed", 3, undefined],
    ]);
  });

  it("相同 JSON 返回空列表且对象键顺序不影响结果", () => {
    expect(diffJson({ a: 1, b: 2 }, { b: 2, a: 1 })).toEqual([]);
  });
});
