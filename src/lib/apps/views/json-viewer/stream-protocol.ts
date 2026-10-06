/**
 * Phase 3 streaming protocol shared by the Worker, JS fallback and row model.
 * Offsets are source offsets; the transport records the byte offset alongside
 * each decoded chunk so a future byte-native WASM ABI can replace the decoder.
 */

export const STREAM_CHUNK_SIZE = 2 * 1024 * 1024;
export const STREAM_INPUT_LIMIT = 3 * 1024 * 1024 * 1024;
export const STREAM_THRESHOLD = 1024 * 1024;
export const STREAM_READONLY_THRESHOLD = 10 * 1024 * 1024;
export const STREAM_ROW_BUFFER_LIMIT = 500_000;

export type ContainerKind = "object" | "array";
export type ScalarKind = "string" | "number" | "boolean" | "null";
export type StreamEvent =
  | { type: "start"; kind: ContainerKind; start: number; end: number; depth: number }
  | { type: "end"; kind: ContainerKind; start: number; end: number; depth: number }
  | { type: "key"; start: number; end: number; depth: number; preview: string }
  | {
      type: "scalar";
      kind: ScalarKind;
      start: number;
      end: number;
      depth: number;
      preview: string;
      skipped: boolean;
    };

export interface StreamStats {
  bytes: number;
  values: number;
  maxDepth: number;
}

export interface StreamError {
  code:
    | "UNEXPECTED_CHAR"
    | "UNTERMINATED_STRING"
    | "INVALID_ESCAPE"
    | "INVALID_NUMBER"
    | "INVALID_UTF8"
    | "EXPECTED_VALUE"
    | "EXPECTED_COLON"
    | "EXPECTED_COMMA_OR_CLOSE"
    | "TRAILING_CONTENT"
    | "TOO_DEEP"
    | "INPUT_TOO_LARGE";
  offset: number;
  message: string;
}

export interface StreamCtx {
  offset: number;
  depth: number;
  rootStarted: boolean;
  rootDone: boolean;
  mode: "normal" | "string" | "number" | "literal";
  numberState:
    | "sign"
    | "zero"
    | "integer"
    | "fraction-start"
    | "fraction"
    | "exponent-start"
    | "exponent-sign"
    | "exponent-digits";
  tokenStart: number;
  tokenPreview: string;
  literal: string;
  literalIndex: number;
  stringEscaped: boolean;
  stringUnicodeRemaining: number;
  stringIsKey: boolean;
  stack: Array<{
    kind: ContainerKind;
    state: "empty" | "key" | "colon" | "value" | "comma";
    start: number;
  }>;
  stats: StreamStats;
}

export interface StepResult {
  next: StreamCtx;
  events: StreamEvent[];
  done: boolean;
  error?: StreamError;
}

export interface StreamCheckpoint {
  offset: number;
  ctx: StreamCtx;
}

export function initialStreamCtx(): StreamCtx {
  return {
    offset: 0,
    depth: 0,
    rootStarted: false,
    rootDone: false,
    mode: "normal",
    numberState: "sign",
    tokenStart: -1,
    tokenPreview: "",
    literal: "",
    literalIndex: 0,
    stringEscaped: false,
    stringUnicodeRemaining: 0,
    stringIsKey: false,
    stack: [],
    stats: { bytes: 0, values: 0, maxDepth: 0 },
  };
}

export function cloneCtx(ctx: StreamCtx): StreamCtx {
  return {
    ...ctx,
    stack: ctx.stack.map((frame) => ({ ...frame })),
    stats: { ...ctx.stats },
  };
}

export function snapshotCtx(ctx: StreamCtx): StreamCheckpoint {
  return { offset: ctx.offset, ctx: cloneCtx(ctx) };
}

export function resumeCtx(checkpoint: StreamCheckpoint): StreamCtx {
  return cloneCtx(checkpoint.ctx);
}

export function skipTo(ctx: StreamCtx, target: number): StreamCtx {
  const next = cloneCtx(ctx);
  if (target > next.offset) next.offset = target;
  next.mode = "normal";
  next.tokenStart = -1;
  next.tokenPreview = "";
  return next;
}

export function streamIsComplete(ctx: StreamCtx): boolean {
  return ctx.rootDone && ctx.stack.length === 0 && ctx.mode === "normal";
}

function previewAppend(ctx: StreamCtx, ch: string): void {
  if (ctx.tokenPreview.length < 120) ctx.tokenPreview += ch;
}

function utf8Length(ch: string): number {
  const code = ch.charCodeAt(0);
  if (code <= 0x7f) return 1;
  if (code <= 0x7ff) return 2;
  if (code >= 0xdc00 && code <= 0xdfff) return 0;
  return code >= 0xd800 && code <= 0xdbff ? 4 : 3;
}

function valueStarted(ctx: StreamCtx): StreamError | undefined {
  if (ctx.rootDone)
    return { code: "TRAILING_CONTENT", offset: ctx.offset, message: "根值结束后存在多余内容" };
  if (!ctx.rootStarted) {
    ctx.rootStarted = true;
  } else {
    const parent = ctx.stack.at(-1);
    if (
      !parent ||
      (parent.state !== "value" && !(parent.kind === "array" && parent.state === "empty"))
    ) {
      return { code: "EXPECTED_COMMA_OR_CLOSE", offset: ctx.offset, message: "值之间缺少逗号" };
    }
    if (parent.kind === "array" && parent.state === "empty") parent.state = "value";
  }
  return undefined;
}

function valueFinished(ctx: StreamCtx): void {
  if (ctx.stack.length === 0) ctx.rootDone = true;
  else {
    const parent = ctx.stack.at(-1);
    if (parent) parent.state = "comma";
  }
}

function finishScalar(ctx: StreamCtx, kind: ScalarKind, end: number, events: StreamEvent[]): void {
  events.push({
    type: "scalar",
    kind,
    start: ctx.tokenStart,
    end,
    depth: ctx.depth + 1,
    preview: ctx.tokenPreview,
    skipped: kind === "string" && end - ctx.tokenStart > 128,
  });
  ctx.stats.values += 1;
  ctx.mode = "normal";
  ctx.tokenStart = -1;
  ctx.tokenPreview = "";
  valueFinished(ctx);
}

function finishContainer(ctx: StreamCtx, kind: ContainerKind, events: StreamEvent[]): void {
  const frame = ctx.stack.at(-1);
  events.push({
    type: "end",
    kind,
    start: frame?.start ?? ctx.offset,
    end: ctx.offset + 1,
    depth: ctx.depth,
  });
  ctx.depth -= 1;
  ctx.stack.pop();
  if (ctx.stack.length === 0) ctx.rootDone = true;
  else {
    const parent = ctx.stack.at(-1);
    if (parent) parent.state = "comma";
  }
}

function isDelimiter(ch: string): boolean {
  return (
    ch === " " ||
    ch === "\n" ||
    ch === "\r" ||
    ch === "\t" ||
    ch === "," ||
    ch === "]" ||
    ch === "}" ||
    ch === ":"
  );
}

function isValidNumberState(state: StreamCtx["numberState"]): boolean {
  return (
    state === "zero" || state === "integer" || state === "fraction" || state === "exponent-digits"
  );
}

function advanceNumber(ctx: StreamCtx, ch: string): boolean {
  const digit = ch >= "0" && ch <= "9";
  switch (ctx.numberState) {
    case "sign":
      if (!digit) return false;
      ctx.numberState = ch === "0" ? "zero" : "integer";
      return true;
    case "zero":
      if (ch === ".") ctx.numberState = "fraction-start";
      else if (ch === "e" || ch === "E") ctx.numberState = "exponent-start";
      else return false;
      return true;
    case "integer":
      if (digit) return true;
      if (ch === ".") ctx.numberState = "fraction-start";
      else if (ch === "e" || ch === "E") ctx.numberState = "exponent-start";
      else return false;
      return true;
    case "fraction-start":
      if (!digit) return false;
      ctx.numberState = "fraction";
      return true;
    case "fraction":
      if (digit) return true;
      if (ch !== "e" && ch !== "E") return false;
      ctx.numberState = "exponent-start";
      return true;
    case "exponent-start":
      if (ch === "+" || ch === "-") ctx.numberState = "exponent-sign";
      else if (digit) ctx.numberState = "exponent-digits";
      else return false;
      return true;
    case "exponent-sign":
      if (!digit) return false;
      ctx.numberState = "exponent-digits";
      return true;
    case "exponent-digits":
      return digit;
  }
}

/** Incrementally consume one decoded chunk without materialising a JSON value. */
export function step(ctxInput: StreamCtx, chunk: string, limit = chunk.length): StepResult {
  const ctx = cloneCtx(ctxInput);
  const events: StreamEvent[] = [];
  let error: StreamError | undefined;
  let i = 0;
  const end = Math.min(limit, chunk.length);
  while (i < end && !error) {
    const ch = chunk[i] ?? "";
    const byteLength = utf8Length(ch);
    if (ctx.mode === "string") {
      if (ctx.stringUnicodeRemaining > 0) {
        if (!/[0-9a-fA-F]/.test(ch))
          error = {
            code: "INVALID_ESCAPE",
            offset: ctx.offset,
            message: "Unicode 转义需要四位十六进制数字",
          };
        else ctx.stringUnicodeRemaining -= 1;
      } else if (ctx.stringEscaped) {
        if (ch === "u") ctx.stringUnicodeRemaining = 4;
        else if (!'"\\/bfnrt'.includes(ch))
          error = { code: "INVALID_ESCAPE", offset: ctx.offset, message: "字符串转义序列不合法" };
        ctx.stringEscaped = false;
      } else if (ch === "\\") {
        ctx.stringEscaped = true;
      } else if (ch === '"') {
        if (ctx.stringUnicodeRemaining > 0 || ctx.stringEscaped)
          error = { code: "UNTERMINATED_STRING", offset: ctx.offset, message: "字符串没有闭合" };
        else if (ctx.stringIsKey) {
          events.push({
            type: "key",
            start: ctx.tokenStart,
            end: ctx.offset + byteLength,
            depth: ctx.depth,
            preview: ctx.tokenPreview,
          });
          const frame = ctx.stack.at(-1);
          if (frame) frame.state = "colon";
          ctx.mode = "normal";
          ctx.tokenStart = -1;
          ctx.tokenPreview = "";
        } else {
          finishScalar(ctx, "string", ctx.offset + byteLength, events);
        }
      } else if (ch < " ") {
        error = {
          code: "UNEXPECTED_CHAR",
          offset: ctx.offset,
          message: "字符串中不能出现裸控制字符",
        };
      } else {
        previewAppend(ctx, ch);
      }
    } else if (ctx.mode === "number" || ctx.mode === "literal") {
      if (!isDelimiter(ch)) {
        if (ctx.mode === "literal") {
          const expected = ctx.literal[ctx.literalIndex + 1];
          if (expected !== ch) {
            error = { code: "UNEXPECTED_CHAR", offset: ctx.offset, message: "字面量不完整" };
          } else {
            previewAppend(ctx, ch);
            ctx.literalIndex += 1;
            if (ctx.literalIndex >= ctx.literal.length - 1)
              finishScalar(
                ctx,
                ctx.literal === "null" ? "null" : "boolean",
                ctx.offset + byteLength,
                events,
              );
          }
        } else if (ctx.mode === "number") {
          if (!advanceNumber(ctx, ch))
            error = { code: "INVALID_NUMBER", offset: ctx.offset, message: "数字格式不合法" };
          else previewAppend(ctx, ch);
        } else {
          previewAppend(ctx, ch);
        }
      } else {
        if (ctx.mode === "literal" && ctx.literalIndex < ctx.literal.length - 1)
          error = { code: "UNEXPECTED_CHAR", offset: ctx.offset, message: "字面量不完整" };
        else if (ctx.mode === "number" && !isValidNumberState(ctx.numberState))
          error = { code: "INVALID_NUMBER", offset: ctx.tokenStart, message: "数字格式不合法" };
        else {
          const kind: ScalarKind =
            ctx.mode === "literal" ? (ctx.literal === "null" ? "null" : "boolean") : "number";
          finishScalar(ctx, kind, ctx.offset, events);
          continue;
        }
      }
    } else if (ch === " " || ch === "\n" || ch === "\r" || ch === "\t") {
      // whitespace
    } else if (ch === '"') {
      const frame = ctx.stack.at(-1);
      const isKey = frame?.kind === "object" && (frame.state === "empty" || frame.state === "key");
      error = isKey ? undefined : valueStarted(ctx);
      if (!error) {
        ctx.mode = "string";
        ctx.stringIsKey = isKey;
        ctx.tokenStart = ctx.offset;
        ctx.tokenPreview = "";
      }
    } else if (ch === "{" || ch === "[") {
      error = valueStarted(ctx);
      if (!error) {
        const kind: ContainerKind = ch === "{" ? "object" : "array";
        ctx.depth += 1;
        if (ctx.depth > 2000)
          error = { code: "TOO_DEEP", offset: ctx.offset, message: "嵌套超过 2000 层" };
        else {
          ctx.stats.values += 1;
          ctx.stats.maxDepth = Math.max(ctx.stats.maxDepth, ctx.depth);
          ctx.stack.push({ kind, state: "empty", start: ctx.offset });
          events.push({
            type: "start",
            kind,
            start: ctx.offset,
            end: ctx.offset + byteLength,
            depth: ctx.depth,
          });
        }
      }
    } else if (ch === "]" || ch === "}") {
      const frame = ctx.stack.at(-1);
      const kind: ContainerKind = ch === "]" ? "array" : "object";
      if (!frame || frame.kind !== kind || (frame.state !== "empty" && frame.state !== "comma")) {
        error = {
          code: "EXPECTED_COMMA_OR_CLOSE",
          offset: ctx.offset,
          message: "括号不匹配或缺少值",
        };
      } else {
        finishContainer(ctx, kind, events);
      }
    } else if (ch === ":") {
      const frame = ctx.stack.at(-1);
      if (!frame || frame.kind !== "object" || frame.state !== "colon")
        error = { code: "EXPECTED_COLON", offset: ctx.offset, message: "键名后缺少冒号" };
      else frame.state = "value";
    } else if (ch === ",") {
      const frame = ctx.stack.at(-1);
      if (!frame || frame.state !== "comma")
        error = { code: "EXPECTED_COMMA_OR_CLOSE", offset: ctx.offset, message: "逗号位置不正确" };
      else frame.state = frame.kind === "object" ? "key" : "value";
    } else if (ch === "-" || /[0-9]/.test(ch)) {
      error = valueStarted(ctx);
      if (!error) {
        ctx.mode = "number";
        ctx.tokenStart = ctx.offset;
        ctx.tokenPreview = ch;
        ctx.numberState = ch === "-" ? "sign" : ch === "0" ? "zero" : "integer";
      }
    } else if (ch === "t" || ch === "f" || ch === "n") {
      error = valueStarted(ctx);
      if (!error) {
        ctx.mode = "literal";
        ctx.literal = ch === "t" ? "true" : ch === "f" ? "false" : "null";
        ctx.literalIndex = 0;
        ctx.tokenStart = ctx.offset;
        ctx.tokenPreview = ch;
      }
    } else {
      error = { code: "UNEXPECTED_CHAR", offset: ctx.offset, message: "无法作为 JSON 值的开始" };
    }
    ctx.offset += byteLength;
    ctx.stats.bytes = ctx.offset;
    i += 1;
  }
  return { next: ctx, events, done: streamIsComplete(ctx), ...(error ? { error } : {}) };
}

/** Flush the final token and reject incomplete container/token state. */
export function finishStream(ctxInput: StreamCtx): StepResult {
  const ctx = cloneCtx(ctxInput);
  const events: StreamEvent[] = [];
  if (ctx.mode === "string") {
    return {
      next: ctx,
      events,
      done: false,
      error: { code: "UNTERMINATED_STRING", offset: ctx.offset, message: "字符串没有闭合" },
    };
  }
  if (ctx.mode === "number") {
    if (!isValidNumberState(ctx.numberState)) {
      return {
        next: ctx,
        events,
        done: false,
        error: { code: "INVALID_NUMBER", offset: ctx.tokenStart, message: "数字格式不合法" },
      };
    }
    finishScalar(ctx, "number", ctx.offset, events);
  } else if (ctx.mode === "literal") {
    if (ctx.literalIndex !== ctx.literal.length - 1) {
      return {
        next: ctx,
        events,
        done: false,
        error: { code: "UNEXPECTED_CHAR", offset: ctx.offset, message: "字面量不完整" },
      };
    }
    finishScalar(ctx, ctx.literal === "null" ? "null" : "boolean", ctx.offset, events);
  }
  if (ctx.stack.length > 0 || !ctx.rootDone) {
    return {
      next: ctx,
      events,
      done: false,
      error: { code: "EXPECTED_VALUE", offset: ctx.offset, message: "输入在 JSON 值完成前结束" },
    };
  }
  return { next: ctx, events, done: true };
}
