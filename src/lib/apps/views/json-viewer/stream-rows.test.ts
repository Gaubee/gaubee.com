import { describe, expect, it } from "vitest";

import { initialStreamCtx, step } from "./stream-protocol";
import { StreamRowModel } from "./stream-rows";

function eventsOf(source: string) {
  const result = step(initialStreamCtx(), source);
  expect(result.error).toBeUndefined();
  return result.events;
}

describe("StreamRowModel", () => {
  it("projects compact rows and retains giant scalar source spans", () => {
    const model = new StreamRowModel();
    model.append(eventsOf(`{"blob":"${"x".repeat(200)}","ok":true}`));
    const rows = model.readRows(0, 10).rows;
    expect(rows.map((row) => row.kind)).toEqual(["object", "string", "boolean"]);
    expect(rows[1]).toMatchObject({ name: "blob", skipped: true, preview: "x".repeat(120) });
    expect(rows[1]?.end).toBe(210);
    expect(rows[2]?.name).toBe("ok");
  });

  it("creates aggregate child rows for large containers", () => {
    const model = new StreamRowModel({ aggregateThreshold: 2 });
    model.append(eventsOf("[1,2,3]"));
    const root = model.readRows(0, 1).rows[0];
    expect(root?.childCount).toBe(3);
    expect(model.childrenOf(root!.id).rows[0]).toMatchObject({
      aggregate: true,
      preview: "3 items",
    });
    expect(model.childrenOf(root!.id, 1, 2).rows.map((row) => row.preview)).toEqual(["2", "3"]);
    expect(model.visibleCount(new Set())).toBe(1);
    expect(model.visibleCount(new Set([root!.id]))).toBe(2);
    expect(model.visibleRows(new Set([root!.id]), 1, 1).rows[0]?.aggregate).toBe(true);
  });

  it("bounds retained rows and exposes checkpoints by binary search", () => {
    const model = new StreamRowModel({ rowLimit: 2 });
    model.append(eventsOf("[1,2,3]"));
    expect(model.truncated).toBe(true);
    expect(model.size).toBe(2);
    model.addCheckpoint({ offset: 10, ctx: initialStreamCtx() });
    model.addCheckpoint({ offset: 20, ctx: initialStreamCtx() });
    expect(model.nearestCheckpoint(19)?.offset).toBe(10);
  });
});
