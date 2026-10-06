/** Main-thread bridge for the streaming JSON worker. */
import {
  STREAM_CHUNK_SIZE,
  STREAM_INPUT_LIMIT,
  STREAM_THRESHOLD,
  type StreamCheckpoint,
  type StreamEvent,
} from "./stream-protocol";
import type { StreamWorkerRequest, StreamWorkerResponse } from "./stream-worker";

export interface StreamProgress {
  loadedBytes: number;
  totalBytes: number;
  events: StreamEvent[];
}

export interface StreamRunResult {
  checkpoints: StreamCheckpoint[];
  events: StreamEvent[];
  loadedBytes: number;
  totalBytes: number;
}

export function shouldUseStreaming(byteLength: number): boolean {
  return byteLength > STREAM_THRESHOLD;
}

export function assertStreamSize(byteLength: number): void {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > STREAM_INPUT_LIMIT) {
    throw new RangeError("JSON 输入超过 3GB 流式查看上限");
  }
}

export interface StreamClientOptions {
  workerFactory?: () => Worker;
  onProgress?: (progress: StreamProgress) => void;
  onEvents?: (events: StreamEvent[]) => void;
  onCheckpoint?: (checkpoint: StreamCheckpoint) => void;
  signal?: AbortSignal;
  collectEvents?: boolean;
}

/**
 * Reads a File with the browser stream API and transfers each buffer exactly
 * once. The input remains a File reference, so giant values never become a JS
 * string on the main thread.
 */
export async function runStreamFile(
  file: Blob,
  options: StreamClientOptions = {},
): Promise<StreamRunResult> {
  assertStreamSize(file.size);
  const worker =
    options.workerFactory?.() ??
    new Worker(new URL("./stream-worker.ts", import.meta.url), { type: "module" });
  const checkpoints: StreamCheckpoint[] = [];
  const events: StreamEvent[] = [];
  let loadedBytes = 0;
  let sentBytes = 0;
  let sequence = 0;
  const returnedBuffers: ArrayBuffer[] = [];
  const inflight = new Map<
    number,
    { promise: Promise<void>; resolve: () => void; reject: (error: unknown) => void }
  >();
  let settled = false;
  let readyResolve: (() => void) | undefined;
  let readyReject: ((reason?: unknown) => void) | undefined;
  const readyPromise = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  let rejectRun: ((reason?: unknown) => void) | undefined;
  let resolveRun: ((value: StreamRunResult) => void) | undefined;
  const resultPromise = new Promise<StreamRunResult>((resolve, reject) => {
    resolveRun = resolve;
    rejectRun = reject;
  });
  void resultPromise.catch(() => {});
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const fail = (error: unknown) => {
    if (settled) return;
    settled = true;
    for (const slot of inflight.values()) slot.reject(error);
    inflight.clear();
    readyReject?.(error);
    rejectRun?.(error);
    void reader?.cancel(error).catch(() => {});
    worker.terminate();
  };
  worker.onmessage = (event: MessageEvent<StreamWorkerResponse>) => {
    const message = event.data;
    if (message.type === "ready") readyResolve?.();
    else if (message.type === "progress") {
      loadedBytes = message.loadedBytes;
      if (options.collectEvents) events.push(...message.events);
      options.onEvents?.(message.events);
      options.onProgress?.(message);
    } else if (message.type === "checkpoint") {
      checkpoints.push(message.checkpoint);
      options.onCheckpoint?.(message.checkpoint);
    } else if (message.type === "ack") {
      const slot = inflight.get(message.sequence);
      if (slot) {
        inflight.delete(message.sequence);
        if (returnedBuffers.length < 2) returnedBuffers.push(message.buffer);
        slot.resolve();
      }
    } else if (message.type === "done") {
      if (options.collectEvents) events.push(...message.events);
      options.onEvents?.(message.events);
      settled = true;
      resolveRun?.({ checkpoints, events, loadedBytes, totalBytes: file.size });
      worker.terminate();
    } else if (message.type === "error") {
      fail(new Error(message.error.message));
    } else if (message.type === "cancelled") {
      fail(new DOMException("流式解析已取消", "AbortError"));
    }
  };
  worker.onerror = (event) => {
    fail(event.error ?? new Error(event.message));
  };
  worker.postMessage({
    type: "start",
    totalBytes: file.size,
    chunkSize: STREAM_CHUNK_SIZE,
  } satisfies StreamWorkerRequest);
  const abort = () => {
    if (settled) return;
    worker.postMessage({ type: "cancel" } satisfies StreamWorkerRequest);
    fail(new DOMException("流式解析已取消", "AbortError"));
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  try {
    await readyPromise;
    reader = file.stream().getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (settled) throw new DOMException("流式解析已取消", "AbortError");
        for (let offset = 0; offset < value.byteLength; offset += STREAM_CHUNK_SIZE) {
          if (inflight.size >= 2) {
            const oldest = inflight.values().next().value as { promise: Promise<void> } | undefined;
            if (oldest) await oldest.promise;
          }
          if (settled) throw new DOMException("流式解析已取消", "AbortError");
          const byteLength = Math.min(STREAM_CHUNK_SIZE, value.byteLength - offset);
          let transferable = returnedBuffers.find((buffer) => buffer.byteLength >= byteLength);
          if (transferable) returnedBuffers.splice(returnedBuffers.indexOf(transferable), 1);
          else transferable = new ArrayBuffer(byteLength);
          new Uint8Array(transferable, 0, byteLength).set(
            value.subarray(offset, offset + byteLength),
          );
          const currentSequence = sequence++;
          let resolveAck: () => void = () => {};
          let rejectAck: (error: unknown) => void = () => {};
          const ackPromise = new Promise<void>((resolve, reject) => {
            resolveAck = resolve;
            rejectAck = reject;
          });
          void ackPromise.catch(() => {});
          inflight.set(currentSequence, {
            promise: ackPromise,
            resolve: resolveAck,
            reject: rejectAck,
          });
          worker.postMessage(
            {
              type: "chunk",
              buffer: transferable,
              byteLength,
              byteOffset: sentBytes,
              sequence: currentSequence,
            } satisfies StreamWorkerRequest,
            [transferable],
          );
          sentBytes += byteLength;
        }
      }
    } finally {
      reader.releaseLock();
    }
    if (settled) throw new DOMException("流式解析已取消", "AbortError");
    if (sentBytes !== file.size) throw new Error("实际读取长度与文件大小不一致");
    await Promise.all([...inflight.values()].map((slot) => slot.promise));
    worker.postMessage({ type: "finish" } satisfies StreamWorkerRequest);
    return await resultPromise;
  } catch (error) {
    if (!settled) {
      settled = true;
      worker.terminate();
    }
    throw error;
  } finally {
    options.signal?.removeEventListener("abort", abort);
  }
}

export function cancelStream(worker: Worker): void {
  worker.postMessage({ type: "cancel" } satisfies StreamWorkerRequest);
}
