import { describe, expect, it } from "vitest";

import { runStreamFile } from "./stream-client";
import { StreamRowModel } from "./stream-rows";
import { createStreamWorkerRuntime, type WorkerScopeLike } from "./stream-worker";

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  readonly #runtime: WorkerScopeLike;

  constructor() {
    this.#runtime = {
      get onmessage() {
        return this._handler;
      },
      set onmessage(value) {
        this._handler = value;
      },
      postMessage: (message, transfer) => {
        if (this.terminated) return;
        this.onmessage?.({ data: message } as MessageEvent);
        void transfer;
      },
    } as WorkerScopeLike & { _handler: ((event: MessageEvent) => void) | null };
    createStreamWorkerRuntime(this.#runtime);
  }

  postMessage(message: unknown, transfer?: Transferable[]): void {
    if (this.terminated) return;
    this.#runtime.onmessage?.({ data: message } as MessageEvent);
    void transfer;
  }

  terminate(): void {
    this.terminated = true;
  }
}

describe("stream client and worker transport", () => {
  it("completes a real File.stream transfer through the worker runtime", async () => {
    const worker = new FakeWorker();
    const events: string[] = [];
    const result = await runStreamFile(new Blob(['{"items":[1,true,null]}']), {
      workerFactory: () => worker as unknown as Worker,
      collectEvents: true,
      onEvents: (batch) => events.push(...batch.map((event) => event.type)),
    });
    expect(result.loadedBytes).toBe(result.totalBytes);
    expect(events).toContain("start");
    expect(events).toContain("scalar");
    expect(worker.terminated).toBe(true);
  });

  it("feeds giant scalar events into the row model without copying the value", async () => {
    const worker = new FakeWorker();
    const model = new StreamRowModel();
    const source = `{"blob":"${"x".repeat(1_100_000)}"}`;
    await runStreamFile(new Blob([source]), {
      workerFactory: () => worker as unknown as Worker,
      onEvents: (batch) => model.append(batch),
    });
    const rows = model.readRows(0, 2).rows;
    expect(rows[0]?.childCount).toBe(1);
    expect(rows[1]).toMatchObject({ skipped: true, preview: "x".repeat(120) });
  });
});
