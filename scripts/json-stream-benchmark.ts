import { execFile } from "node:child_process";
/**
 * Phase 3 large-input benchmark.
 *
 * Samples are generated directly to a temporary file, then consumed in
 * 2 MiB windows. JSON.parse is guarded because it necessarily materialises the
 * complete source string; the streaming engines keep only one window alive.
 */
import { once } from "node:events";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";

import {
  finishStream,
  initialStreamCtx,
  step,
  STREAM_CHUNK_SIZE,
} from "../src/lib/apps/views/json-viewer/stream-protocol";

const execFileAsync = promisify(execFile);
const WASM_PATH = join(
  import.meta.dirname,
  "../wasm/json-stream/_build/wasm/release/build/json-stream.wasm",
);
const MOON_ROOT = join(import.meta.dirname, "../wasm/json-stream");
const DATA_PTR = 16 * 1024 * 1024;
const DEFAULT_PARSE_LIMIT_MB = 512;

type Shape = "fragment" | "giant";
type Engine = "MoonBit-wasm" | "MoonBit-native" | "JS-fallback" | "JSON.parse";

interface EngineResult {
  engine: Engine;
  status: "ok" | "skipped" | "error";
  elapsedMs: number | null;
  rssPeakMiB: number | null;
  rssDeltaMiB: number | null;
  maxChunkMs: number | null;
  reason?: string;
}

interface WasmRunner {
  reset(): void;
  step(bytes: Uint8Array): number;
}

function rssMiB(): number {
  return process.memoryUsage().rss / 1024 / 1024;
}

async function writeChunk(
  stream: ReturnType<typeof createWriteStream>,
  chunk: Buffer,
): Promise<void> {
  if (!stream.write(chunk)) await once(stream, "drain");
}

async function writeRepeated(
  stream: ReturnType<typeof createWriteStream>,
  token: string,
  count: number,
): Promise<void> {
  const tokenBytes = Buffer.byteLength(token);
  const unitCount = Math.max(1, Math.floor((1024 * 1024) / tokenBytes));
  const unit = Buffer.from(token.repeat(unitCount));
  let remaining = count;
  while (remaining > 0) {
    const units = Math.min(remaining, unitCount);
    await writeChunk(stream, unit.subarray(0, units * tokenBytes));
    remaining -= units;
  }
}

async function generateSample(path: string, megabytes: number, shape: Shape): Promise<number> {
  const stream = createWriteStream(path, { flags: "w" });
  const target = megabytes * 1024 * 1024;
  try {
    if (shape === "fragment") {
      // `[0,` repeated N-1 followed by `0] ` gives an exact even byte length;
      // the trailing whitespace remains valid JSON and closes the size gap.
      await writeChunk(stream, Buffer.from("["));
      await writeRepeated(stream, "0,", Math.max(0, Math.floor((target - 4) / 2)));
      await writeChunk(stream, Buffer.from("0] "));
    } else {
      const prefix = Buffer.from('{"blob":"');
      const suffix = Buffer.from('"}');
      await writeChunk(stream, prefix);
      await writeRepeated(stream, "x", Math.max(0, target - prefix.length - suffix.length));
      await writeChunk(stream, suffix);
    }
  } finally {
    stream.end();
    await once(stream, "close");
  }
  return (await stat(path)).size;
}

async function loadWasmRunner(): Promise<WasmRunner> {
  const module = await WebAssembly.compile(await readFile(WASM_PATH));
  const memory = new WebAssembly.Memory({ initial: 1024, maximum: 65536, shared: true });
  const instance = await WebAssembly.instantiate(module, { env: { memory } });
  const exports = instance.exports as unknown as {
    json_stream_reset: () => number;
    json_stream_step: (ptr: number, len: number, pos: number, limit: number) => number;
  };
  return {
    reset: () => {
      exports.json_stream_reset();
    },
    step: (bytes) => {
      if (DATA_PTR + bytes.byteLength > memory.buffer.byteLength) {
        const pages = Math.ceil((DATA_PTR + bytes.byteLength - memory.buffer.byteLength) / 65536);
        memory.grow(pages);
      }
      new Uint8Array(memory.buffer, DATA_PTR, bytes.byteLength).set(bytes);
      return exports.json_stream_step(DATA_PTR, bytes.byteLength, 0, bytes.byteLength);
    },
  };
}

async function measureStream(
  file: string,
  engine: Exclude<Engine, "MoonBit-native" | "JSON.parse">,
  consume: (bytes: Uint8Array) => void,
): Promise<EngineResult> {
  const before = rssMiB();
  let peak = before;
  let maxChunkMs = 0;
  const start = performance.now();
  try {
    for await (const chunk of createReadStream(file, { highWaterMark: STREAM_CHUNK_SIZE })) {
      const bytes = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      const chunkStart = performance.now();
      consume(bytes);
      maxChunkMs = Math.max(maxChunkMs, performance.now() - chunkStart);
      peak = Math.max(peak, rssMiB());
    }
    return {
      engine,
      status: "ok",
      elapsedMs: performance.now() - start,
      rssPeakMiB: peak,
      rssDeltaMiB: peak - before,
      maxChunkMs,
    };
  } catch (error) {
    return {
      engine,
      status: "error",
      elapsedMs: performance.now() - start,
      rssPeakMiB: peak,
      rssDeltaMiB: peak - before,
      maxChunkMs,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function benchmarkJs(file: string): Promise<EngineResult> {
  let ctx = initialStreamCtx();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const result = await measureStream(file, "JS-fallback", (bytes) => {
    const stepped = step(ctx, decoder.decode(bytes, { stream: true }));
    ctx = stepped.next;
    if (stepped.error) throw new Error(stepped.error.message);
  });
  const tail = decoder.decode();
  if (result.status === "ok" && tail) {
    const stepped = step(ctx, tail);
    ctx = stepped.next;
    if (stepped.error) return { ...result, status: "error", reason: stepped.error.message };
  }
  if (result.status === "ok") {
    const finished = finishStream(ctx);
    if (finished.error) return { ...result, status: "error", reason: finished.error.message };
  }
  return result;
}

async function benchmarkWasm(file: string): Promise<EngineResult> {
  const runner = await loadWasmRunner();
  runner.reset();
  return measureStream(file, "MoonBit-wasm", (bytes) => {
    if (runner.step(bytes) < 0) throw new Error("WASM parser rejected input");
  });
}

async function benchmarkJsonParse(file: string, parseLimitBytes: number): Promise<EngineResult> {
  const size = (await stat(file)).size;
  if (size > parseLimitBytes) {
    return {
      engine: "JSON.parse",
      status: "skipped",
      elapsedMs: null,
      rssPeakMiB: null,
      rssDeltaMiB: null,
      maxChunkMs: null,
      reason: `超过 ${Math.round(parseLimitBytes / 1024 / 1024)} MiB 内存保护阈值`,
    };
  }
  const before = rssMiB();
  const start = performance.now();
  try {
    JSON.parse(await readFile(file, "utf8"));
    const elapsedMs = performance.now() - start;
    const peak = rssMiB();
    return {
      engine: "JSON.parse",
      status: "ok",
      elapsedMs,
      rssPeakMiB: peak,
      rssDeltaMiB: peak - before,
      maxChunkMs: elapsedMs,
    };
  } catch (error) {
    const elapsedMs = performance.now() - start;
    const peak = rssMiB();
    return {
      engine: "JSON.parse",
      status: "error",
      elapsedMs,
      rssPeakMiB: peak,
      rssDeltaMiB: peak - before,
      maxChunkMs: elapsedMs,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function childProcessOutput(error: unknown, key: "stdout" | "stderr"): string {
  if (typeof error !== "object" || error === null || !(key in error)) return "";
  const value = error[key];
  return typeof value === "string" ? value : "";
}

async function benchmarkNative(
  megabytes: number,
  shape: Shape,
  expectedBytes: number,
): Promise<EngineResult> {
  const start = performance.now();
  try {
    const { stdout, stderr } = await execFileAsync(
      "/usr/bin/time",
      [
        "-l",
        "moon",
        "run",
        "./bench",
        "--target",
        "native",
        "--release",
        "--",
        String(megabytes),
        shape,
      ],
      { cwd: MOON_ROOT, maxBuffer: 1024 * 1024 },
    );
    const bytesMatch = stdout.match(/(?:^|\n)bytes=(\d+)(?:\s|$)/);
    if (!bytesMatch) throw new Error(`native helper 未输出 bytes=：${stdout.trim()}`);
    const bytes = Number(bytesMatch[1]);
    if (bytes !== expectedBytes) {
      throw new Error(`native helper 字节数不符：expected=${expectedBytes} actual=${bytes}`);
    }
    const elapsedMs = performance.now() - start;
    const rssMatch =
      stderr.match(/(?:maximum resident set size|peak memory footprint):\s+(\d+)/) ??
      stderr.match(/(\d+)\s+(?:maximum resident set size|peak memory footprint)/);
    const peak = rssMatch ? Number(rssMatch[1]) / 1024 / 1024 : null;
    return {
      engine: "MoonBit-native",
      status: "ok",
      elapsedMs,
      rssPeakMiB: peak,
      rssDeltaMiB: null,
      maxChunkMs: null,
    };
  } catch (error) {
    const stdout = childProcessOutput(error, "stdout").trim();
    const stderr = childProcessOutput(error, "stderr").trim();
    const diagnostics = [error instanceof Error ? error.message : String(error), stdout, stderr]
      .filter(Boolean)
      .join("\n");
    return {
      engine: "MoonBit-native",
      status: "error",
      elapsedMs: performance.now() - start,
      rssPeakMiB: null,
      rssDeltaMiB: null,
      maxChunkMs: null,
      reason: diagnostics,
    };
  }
}

function optionValue(args: readonly string[], name: string): string | undefined {
  return args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
}

async function benchmarkWorker(
  engine: Exclude<Engine, "MoonBit-native">,
  file: string,
  parseLimit: number,
): Promise<void> {
  const result =
    engine === "JSON.parse"
      ? await benchmarkJsonParse(file, parseLimit)
      : engine === "JS-fallback"
        ? await benchmarkJs(file)
        : await benchmarkWasm(file);
  console.log(JSON.stringify(result));
}

async function benchmarkIsolated(
  engine: Exclude<Engine, "MoonBit-native">,
  file: string,
  parseLimit: number,
): Promise<EngineResult> {
  try {
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        "--import",
        "tsx",
        import.meta.filename,
        "--worker",
        `--engine=${engine}`,
        `--file=${file}`,
        `--parse-limit-bytes=${parseLimit}`,
      ],
      { maxBuffer: 1024 * 1024 },
    );
    const line = stdout.trim().split("\n").at(-1);
    if (!line) throw new Error("benchmark worker returned no result");
    return JSON.parse(line) as EngineResult;
  } catch (error) {
    return {
      engine,
      status: "error",
      elapsedMs: null,
      rssPeakMiB: null,
      rssDeltaMiB: null,
      maxChunkMs: null,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function parseArgs(): { sizes: number[]; shapes: Shape[]; parseLimit: number; engines: Engine[] } {
  const args = process.argv.slice(2);
  const positional = args.filter((arg) => /^\d+(?:\.\d+)?$/.test(arg));
  const sizes = positional.length > 0 ? positional.map(Number) : [1, 10];
  const shapeArg = args.find((arg) => arg.startsWith("--shapes="))?.slice(9);
  const shapes = (shapeArg?.split(",") ?? ["fragment", "giant"]).filter(
    (shape): shape is Shape => shape === "fragment" || shape === "giant",
  );
  const parseArg = args.find((arg) => arg.startsWith("--parse-limit-mb="))?.slice(17);
  const parseLimit = Number(parseArg ?? DEFAULT_PARSE_LIMIT_MB);
  const engineArg = args.find((arg) => arg.startsWith("--engines="))?.slice(10);
  const engines = (
    engineArg?.split(",") ?? ["JSON.parse", "JS-fallback", "MoonBit-wasm", "MoonBit-native"]
  ).filter(
    (engine): engine is Engine =>
      engine === "JSON.parse" ||
      engine === "JS-fallback" ||
      engine === "MoonBit-wasm" ||
      engine === "MoonBit-native",
  );
  return {
    sizes,
    shapes: shapes.length > 0 ? shapes : ["fragment", "giant"],
    parseLimit,
    engines:
      engines.length > 0
        ? engines
        : ["JSON.parse", "JS-fallback", "MoonBit-wasm", "MoonBit-native"],
  };
}

async function main(): Promise<void> {
  const { sizes, shapes, parseLimit, engines } = parseArgs();
  await mkdir(join(tmpdir(), "gaubee-json-bench"), { recursive: true });
  const wasmAvailable = await readFile(WASM_PATH).then(
    () => true,
    () => false,
  );
  for (const megabytes of sizes) {
    for (const shape of shapes) {
      const file = join(
        tmpdir(),
        "gaubee-json-bench",
        `sample-${process.pid}-${megabytes}-${shape}.json`,
      );
      try {
        const bytes = await generateSample(file, megabytes, shape);
        const expectedBytes = megabytes * 1024 * 1024;
        if (bytes !== expectedBytes) {
          throw new Error(`样本字节数不符：expected=${expectedBytes} actual=${bytes}`);
        }
        const parseLimitBytes = parseLimit * 1024 * 1024;
        const results: EngineResult[] = [];
        for (const engine of engines) {
          if (engine === "MoonBit-native") {
            results.push(await benchmarkNative(megabytes, shape, bytes));
          } else if (engine === "MoonBit-wasm" && !wasmAvailable) {
            results.push({
              engine,
              status: "skipped",
              elapsedMs: null,
              rssPeakMiB: null,
              rssDeltaMiB: null,
              maxChunkMs: null,
              reason: "WASM 产物不存在",
            });
          } else {
            results.push(await benchmarkIsolated(engine, file, parseLimitBytes));
          }
        }
        console.log(JSON.stringify({ megabytes, shape, bytes, results }));
      } finally {
        await unlink(file).catch(() => undefined);
      }
    }
  }
}

const cliArgs = process.argv.slice(2);
if (cliArgs.includes("--worker")) {
  const engine = optionValue(cliArgs, "--engine") as Exclude<Engine, "MoonBit-native"> | undefined;
  const file = optionValue(cliArgs, "--file");
  const parseLimit = Number(
    optionValue(cliArgs, "--parse-limit-bytes") ?? DEFAULT_PARSE_LIMIT_MB * 1024 * 1024,
  );
  if (!engine || !file) throw new Error("benchmark worker requires --engine and --file");
  await benchmarkWorker(engine, file, parseLimit);
} else {
  await main();
}
