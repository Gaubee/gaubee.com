import { describe, expect, it, vi } from "vitest";

import { assertStreamSize, shouldUseStreaming } from "./stream-client";
import { STREAM_INPUT_LIMIT, STREAM_THRESHOLD } from "./stream-protocol";

describe("stream client boundary", () => {
  it("keeps the Phase 2 path below the threshold", () => {
    expect(shouldUseStreaming(STREAM_THRESHOLD)).toBe(false);
    expect(shouldUseStreaming(STREAM_THRESHOLD + 1)).toBe(true);
  });

  it("rejects unsafe and over-limit inputs before creating a worker", () => {
    expect(() => assertStreamSize(STREAM_INPUT_LIMIT + 1)).toThrow("3GB");
    expect(() => assertStreamSize(Number.MAX_SAFE_INTEGER + 1)).toThrow("3GB");
    expect(() => assertStreamSize(0)).not.toThrow();
  });

  it("does not need browser globals for boundary decisions", () => {
    expect(vi.isMockFunction(shouldUseStreaming)).toBe(false);
  });
});
