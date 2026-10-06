/**
 * Worker-side stream runner. The default channel is Transferable ArrayBuffer;
 * the parser never receives the complete input, only decoded chunks.
 */
import {
  finishStream,
  initialStreamCtx,
  snapshotCtx,
  step,
  STREAM_CHUNK_SIZE,
  STREAM_INPUT_LIMIT,
  type StreamCheckpoint,
  type StreamCtx,
  type StreamError,
  type StreamEvent,
} from "./stream-protocol";

export type StreamWorkerRequest =
  | { type: "start"; totalBytes: number; chunkSize?: number }
  | {
      type: "chunk";
      buffer: ArrayBuffer;
      byteLength: number;
      byteOffset: number;
      sequence: number;
    }
  | { type: "finish" }
  | { type: "cancel" };

export type StreamWorkerResponse =
  | { type: "ready"; engine: "wasm" | "js"; chunkSize: number }
  | { type: "progress"; loadedBytes: number; totalBytes: number; events: StreamEvent[] }
  | { type: "ack"; sequence: number; buffer: ArrayBuffer }
  | { type: "checkpoint"; checkpoint: StreamCheckpoint }
  | { type: "done"; ctx: StreamCtx; events: StreamEvent[] }
  | { type: "error"; error: StreamError }
  | { type: "cancelled" };

export interface WorkerScopeLike {
  onmessage: ((event: MessageEvent<StreamWorkerRequest>) => void) | null;
  postMessage(message: StreamWorkerResponse, transfer?: Transferable[]): void;
}

export function createStreamWorkerRuntime(workerScope: WorkerScopeLike): void {
  let ctx = initialStreamCtx();
  let totalBytes = 0;
  let loadedBytes = 0;
  let checkpointBytes = 0;
  let expectedSequence = 0;
  let cancelled = false;
  let decoder: TextDecoder | undefined;

  function post(message: StreamWorkerResponse, transfer?: Transferable[]): void {
    workerScope.postMessage(message, transfer);
  }

  function postError(error: StreamError): void {
    post({ type: "error", error });
  }

  function handleStart(message: Extract<StreamWorkerRequest, { type: "start" }>): void {
    if (
      !Number.isSafeInteger(message.totalBytes) ||
      message.totalBytes < 0 ||
      message.totalBytes > STREAM_INPUT_LIMIT
    ) {
      postError({ code: "INPUT_TOO_LARGE", offset: 0, message: "输入超过 3GB 流式查看上限" });
      return;
    }
    ctx = initialStreamCtx();
    totalBytes = message.totalBytes;
    loadedBytes = 0;
    checkpointBytes = 0;
    expectedSequence = 0;
    cancelled = false;
    decoder = new TextDecoder("utf-8", { fatal: true });
    post({ type: "ready", engine: "js", chunkSize: message.chunkSize ?? STREAM_CHUNK_SIZE });
  }

  function handleChunk(message: Extract<StreamWorkerRequest, { type: "chunk" }>): void {
    if (cancelled || !decoder) return;
    if (
      !Number.isSafeInteger(message.byteLength) ||
      message.byteLength < 0 ||
      message.byteLength > message.buffer.byteLength ||
      !Number.isSafeInteger(message.byteOffset) ||
      message.byteOffset !== loadedBytes ||
      !Number.isSafeInteger(message.sequence) ||
      message.sequence !== expectedSequence
    ) {
      postError({ code: "INPUT_TOO_LARGE", offset: ctx.offset, message: "分块长度不合法" });
      cancelled = true;
      return;
    }
    if (
      loadedBytes + message.byteLength > totalBytes ||
      loadedBytes + message.byteLength > STREAM_INPUT_LIMIT
    ) {
      postError({
        code: "INPUT_TOO_LARGE",
        offset: ctx.offset,
        message: "分块超过声明的输入长度或 3GB 上限",
      });
      cancelled = true;
      return;
    }
    let text: string;
    try {
      text = decoder.decode(new Uint8Array(message.buffer, 0, message.byteLength), {
        stream: true,
      });
    } catch {
      postError({
        code: "INVALID_UTF8",
        offset: ctx.offset,
        message: "JSON 文件不是有效的 UTF-8 文本",
      });
      cancelled = true;
      return;
    }
    loadedBytes += message.byteLength;
    expectedSequence += 1;
    const result = step(ctx, text);
    ctx = result.next;
    if (result.error) {
      postError(result.error);
      cancelled = true;
      return;
    }
    post({ type: "progress", loadedBytes, totalBytes, events: result.events });
    if (loadedBytes - checkpointBytes >= STREAM_CHUNK_SIZE) {
      checkpointBytes = loadedBytes;
      post({ type: "checkpoint", checkpoint: snapshotCtx(ctx) });
    }
    post({ type: "ack", sequence: message.sequence, buffer: message.buffer }, [message.buffer]);
  }

  function handleFinish(): void {
    if (cancelled || !decoder) return;
    if (loadedBytes !== totalBytes) {
      postError({
        code: "INPUT_TOO_LARGE",
        offset: ctx.offset,
        message: "实际读取长度与文件大小不一致",
      });
      cancelled = true;
      return;
    }
    let tail: string;
    try {
      tail = decoder.decode();
    } catch {
      postError({
        code: "INVALID_UTF8",
        offset: ctx.offset,
        message: "JSON 文件在 UTF-8 字符中途结束",
      });
      cancelled = true;
      return;
    }
    if (tail) {
      const result = step(ctx, tail);
      ctx = result.next;
      if (result.error) {
        postError(result.error);
        return;
      }
      post({ type: "progress", loadedBytes, totalBytes, events: result.events });
    }
    const result = finishStream(ctx);
    if (result.error) {
      postError(result.error);
      return;
    }
    post({ type: "done", ctx: result.next, events: result.events });
  }

  workerScope.onmessage = (event) => {
    const message = event.data;
    switch (message.type) {
      case "start":
        handleStart(message);
        break;
      case "chunk":
        handleChunk(message);
        break;
      case "finish":
        handleFinish();
        break;
      case "cancel":
        cancelled = true;
        post({ type: "cancelled" });
        break;
    }
  };
}

if (
  typeof document === "undefined" &&
  typeof (globalThis as { importScripts?: unknown }).importScripts === "function"
) {
  createStreamWorkerRuntime(globalThis as typeof globalThis & WorkerScopeLike);
}
