import { describe, expect, it } from "vitest";

import {
  finishStream,
  initialStreamCtx,
  snapshotCtx,
  step,
  STREAM_CHUNK_SIZE,
  STREAM_INPUT_LIMIT,
  STREAM_READONLY_THRESHOLD,
  STREAM_THRESHOLD,
} from "./stream-protocol";

function parseInChunks(source: string, size: number) {
  let ctx = initialStreamCtx();
  const events = [] as ReturnType<typeof step>["events"];
  for (let i = 0; i < source.length; i += size) {
    const result = step(ctx, source.slice(i, i + size));
    expect(result.error).toBeUndefined();
    ctx = result.next;
    events.push(...result.events);
  }
  const final = finishStream(ctx);
  expect(final.error).toBeUndefined();
  return { ctx: final.next, events: [...events, ...final.events] };
}

describe("stream protocol", () => {
  it("keeps grammar state across token chunk boundaries", () => {
    const result = parseInChunks('{"name":"Ada","items":[true,null,42]}', 3);
    expect(result.ctx.rootDone).toBe(true);
    expect(
      result.events.filter((event) => event.type === "key").map((event) => event.preview),
    ).toEqual(["name", "items"]);
    expect(
      result.events.filter((event) => event.type === "scalar").map((event) => event.kind),
    ).toEqual(["string", "boolean", "null", "number"]);
  });

  it("caps giant string previews and retains offsets", () => {
    const result = parseInChunks(`{"blob":"${"x".repeat(20_000)}"}`, 257);
    const blob = result.events.find((event) => event.type === "scalar");
    expect(blob?.type).toBe("scalar");
    if (blob?.type === "scalar") {
      expect(blob.preview.length).toBe(120);
      expect(blob.skipped).toBe(true);
      expect(blob.end - blob.start).toBe(20_002);
    }
  });

  it("reports incomplete and malformed streams without JSON.parse", () => {
    let ctx = initialStreamCtx();
    ctx = step(ctx, '{"a":').next;
    expect(finishStream(ctx).error?.code).toBe("EXPECTED_VALUE");
    expect(step(initialStreamCtx(), "{'a':1}").error?.code).toBe("UNEXPECTED_CHAR");
  });

  it.each(["{}", "[]", '{"a":1}', "[1]"])("accepts valid boundary form %s", (source) => {
    const result = parseInChunks(source, 1);
    expect(result.ctx.rootDone).toBe(true);
    expect(result.events.some((event) => event.type === "start")).toBe(source.length > 1);
  });

  it.each(["[1,]", '{"a":1,}', '{"a":}', "[,]", "{,}", "truex", "1a", "1.,"])(
    "rejects missing values or trailing commas in %s",
    (source) => {
      let ctx = initialStreamCtx();
      let error: ReturnType<typeof step>["error"];
      for (const ch of source) {
        const result = step(ctx, ch);
        ctx = result.next;
        error = result.error;
        if (error) break;
      }
      expect(error ?? finishStream(ctx).error).toBeDefined();
    },
  );

  it("validates number transitions without retaining the full token", () => {
    for (const source of ["0", "-0", "12", "-12.5e+20", "[0,123456789012345678901234567890]"]) {
      expect(parseInChunks(source, 2).ctx.rootDone).toBe(true);
    }
    for (const source of ["01", "-", "1.", "1e", "1e+", "1.2.3"]) {
      let ctx = initialStreamCtx();
      let error: ReturnType<typeof step>["error"];
      for (const ch of source) {
        const result = step(ctx, ch);
        ctx = result.next;
        error = result.error;
        if (error) break;
      }
      expect(error ?? finishStream(ctx).error).toBeDefined();
    }
  });

  it("snapshots and resumes without sharing mutable stack state", () => {
    const ctx = step(initialStreamCtx(), "[1,").next;
    const checkpoint = snapshotCtx(ctx);
    const resumed = step(checkpoint.ctx, "2]");
    expect(finishStream(resumed.next).done).toBe(true);
    expect(checkpoint.ctx.offset).toBe(3);
  });

  it("publishes bounded transport constants", () => {
    expect(STREAM_CHUNK_SIZE).toBe(2 * 1024 * 1024);
    expect(STREAM_THRESHOLD).toBe(1024 * 1024);
    expect(STREAM_READONLY_THRESHOLD).toBe(10 * 1024 * 1024);
    expect(STREAM_INPUT_LIMIT).toBe(3 * 1024 * 1024 * 1024);
  });
});
