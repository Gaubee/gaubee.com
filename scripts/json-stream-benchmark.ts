/**
 * Phase 3 parser benchmark. Compare the bounded JS chunk protocol with the
 * Phase 2 JSON.parse path and report elapsed time plus RSS deltas.
 */
import { performance } from "node:perf_hooks";

import {
  step,
  finishStream,
  initialStreamCtx,
  STREAM_CHUNK_SIZE,
} from "../src/lib/apps/views/json-viewer/stream-protocol";

const requested = process.argv
  .slice(2)
  .map((value) => Number(value))
  .filter(Number.isFinite);
const sizes = requested.length > 0 ? requested : [10, 100];

function sample(megabytes: number): string {
  const target = Math.max(1, Math.floor(megabytes * 1024 * 1024));
  const item = '"x":0,';
  const repeat = Math.max(1, Math.floor((target - 2) / item.length));
  return `{${item.repeat(repeat).slice(0, -1)}}`;
}

function measure(name: string, fn: () => void): { name: string; ms: number; rssMiB: number } {
  const before = process.memoryUsage().rss;
  const start = performance.now();
  fn();
  return {
    name,
    ms: performance.now() - start,
    rssMiB: (process.memoryUsage().rss - before) / 1024 / 1024,
  };
}

for (const megabytes of sizes) {
  const source = sample(megabytes);
  const results = [
    measure("JSON.parse", () => {
      JSON.parse(source);
    }),
    measure("JS stream step", () => {
      let ctx = initialStreamCtx();
      for (let offset = 0; offset < source.length; offset += STREAM_CHUNK_SIZE) {
        ctx = step(ctx, source.slice(offset, offset + STREAM_CHUNK_SIZE)).next;
      }
      const final = finishStream(ctx);
      if (final.error) throw new Error(final.error.message);
    }),
  ];
  console.log(JSON.stringify({ megabytes, bytes: source.length, results }));
}
