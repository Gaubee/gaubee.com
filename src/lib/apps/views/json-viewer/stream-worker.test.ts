import { describe, expect, it } from "vitest";

import {
  createStreamWorkerRuntime,
  type StreamWorkerResponse,
  type WorkerScopeLike,
} from "./stream-worker";

describe("stream worker runtime", () => {
  it("processes transferable chunks and returns ownership acknowledgements", () => {
    const responses: StreamWorkerResponse[] = [];
    let handler: ((event: MessageEvent) => void) | null = null;
    const scope: WorkerScopeLike = {
      get onmessage() {
        return handler;
      },
      set onmessage(value) {
        handler = value as ((event: MessageEvent) => void) | null;
      },
      postMessage(message) {
        responses.push(message);
      },
    };
    createStreamWorkerRuntime(scope);
    const send = (data: unknown) => handler?.({ data } as MessageEvent);
    send({ type: "start", totalBytes: 7, chunkSize: 2 });
    const bytes = new TextEncoder().encode("[1,2,3]");
    send({
      type: "chunk",
      buffer: bytes.slice(0, 4).buffer,
      byteLength: 4,
      byteOffset: 0,
      sequence: 0,
    });
    send({
      type: "chunk",
      buffer: bytes.slice(4).buffer,
      byteLength: 3,
      byteOffset: 4,
      sequence: 1,
    });
    send({ type: "finish" });
    expect(responses[0]).toMatchObject({ type: "ready", engine: "js", chunkSize: 2 });
    expect(responses.filter((response) => response.type === "ack")).toHaveLength(2);
    expect(responses.at(-1)).toMatchObject({ type: "done" });
  });

  it("rejects reordered chunks and incomplete files before parsing", () => {
    const responses: StreamWorkerResponse[] = [];
    let handler: ((event: MessageEvent) => void) | null = null;
    const scope: WorkerScopeLike = {
      get onmessage() {
        return handler;
      },
      set onmessage(value) {
        handler = value as ((event: MessageEvent) => void) | null;
      },
      postMessage(message) {
        responses.push(message);
      },
    };
    createStreamWorkerRuntime(scope);
    const send = (data: unknown) => handler?.({ data } as MessageEvent);
    send({ type: "start", totalBytes: 2 });
    send({
      type: "chunk",
      buffer: new Uint8Array(["[".charCodeAt(0)]).buffer,
      byteLength: 1,
      byteOffset: 1,
      sequence: 0,
    });
    expect(responses.at(-1)).toMatchObject({ type: "error", error: { code: "INPUT_TOO_LARGE" } });
    responses.length = 0;
    send({ type: "start", totalBytes: 2 });
    send({
      type: "chunk",
      buffer: new Uint8Array([0xff]).buffer,
      byteLength: 1,
      byteOffset: 0,
      sequence: 0,
    });
    expect(responses.at(-1)).toMatchObject({ type: "error", error: { code: "INVALID_UTF8" } });
  });

  it("reports cancellation so callers can settle their run", () => {
    const responses: StreamWorkerResponse[] = [];
    let handler: ((event: MessageEvent) => void) | null = null;
    const scope: WorkerScopeLike = {
      get onmessage() {
        return handler;
      },
      set onmessage(value) {
        handler = value as ((event: MessageEvent) => void) | null;
      },
      postMessage(message) {
        responses.push(message);
      },
    };
    createStreamWorkerRuntime(scope);
    const send = (data: unknown) => handler?.({ data } as MessageEvent);
    send({ type: "start", totalBytes: 0 });
    send({ type: "cancel" });
    expect(responses.at(-1)).toEqual({ type: "cancelled" });
  });
});
