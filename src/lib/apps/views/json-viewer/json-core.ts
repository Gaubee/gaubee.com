/**
 * JSON 查看器核心纯逻辑（无 DOM 依赖，server project 可测）。
 *
 * 为什么不直接用 JSON.parse 的 SyntaxError 定位：
 * 新版 V8（Node 20+ / Chrome 120+）对多数常见错误不再提供 "at position N"，
 * 而是给出省略号上下文（如 `Unexpected token '}', ..."a": 1,}... is not valid JSON`），
 * Firefox 则是自己的行列表述——跨引擎不可靠。因此错误定位由本文件的轻量校验器
 * （RFC 8259 递归下降）承担：行列精确、消息中文、跨引擎一致，
 * 并为后续「错误人话化/修复建议」提供结构化 code。
 *
 * 成功路径仍然走 JSON.parse（引擎优化，值生产者）；校验器只在 parse 失败时兜底定位。
 * 统计遍历用显式栈迭代（深嵌套不爆调用栈）。
 */

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type JsonValueType = "object" | "array" | "string" | "number" | "boolean" | "null";

export type JsonErrorCode =
  | "EMPTY_INPUT" // 空输入（视图层通常不展示此态，防御性返回）
  | "UNEXPECTED_CHAR" // 值的位置上出现了不合法的字符
  | "UNTERMINATED_STRING" // 字符串未闭合
  | "INVALID_ESCAPE" // 非法转义序列
  | "BARE_CONTROL_IN_STRING" // 字符串内有裸控制字符（如裸换行）
  | "EXPECTED_KEY" // 对象的键必须是带双引号的字符串
  | "EXPECTED_COLON" // 键之后缺少冒号
  | "EXPECTED_COMMA_OR_CLOSE" // 缺少逗号或闭合括号
  | "EXPECTED_VALUE" // 缺少值
  | "INVALID_NUMBER" // 数字格式不合法
  | "TOO_DEEP" // 嵌套过深
  | "TRAILING_CONTENT" // 值结束后有多余内容
  | "UNKNOWN"; // 校验器与引擎结论不一致时的防御性兜底

export interface JsonErrorInfo {
  code: JsonErrorCode;
  /** 中文提示（面向初级工程师的可读层）。 */
  message: string;
  /** 面向修复动作的简短建议。 */
  suggestion: string;
  /** 1-based；0 表示未知。 */
  line: number;
  /** 1-based；0 表示未知。 */
  column: number;
  /** 出错行摘录（过长时围绕出错列截断，带省略号）。 */
  excerpt: string;
}

export type ParseOutcome = { ok: true; value: unknown } | { ok: false; error: JsonErrorInfo };

/** 校验器递归深度上限：真实数据远达不到；树视图递归渲染同样受益于此护栏。 */
const MAX_DEPTH = 2000;

// ---------------------------------------------------------------------------
// 公共 API
// ---------------------------------------------------------------------------

/** 解析 JSON 文本：成功返回值；失败返回结构化错误（行列精确）。 */
export function parseJson(text: string): ParseOutcome {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    // JSON.parse 拒绝 → 用校验器找第一个语法错误（校验器是 JSON 语法的忠实实现，
    // 结论应与引擎一致；若不一致以校验器为准——它给出的位置可直接指导修复）。
    return { ok: false, error: locateError(text) };
  }
}

/** 值类型判定（树视图与统计共用）。 */
export function valueTypeOf(v: unknown): JsonValueType {
  if (v === null) return "null";
  switch (typeof v) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "object":
      return Array.isArray(v) ? "array" : "object";
    default:
      return "null"; // undefined 等不可能出现在 JSON.parse 产物中，防御性归 null
  }
}

export interface JsonStats {
  /** 原始文本 UTF-8 字节数。 */
  bytes: number;
  topType: JsonValueType;
  /** 节点总数（容器与标量都计 1）。 */
  nodeCount: number;
  /** 最大嵌套深度（根为 1，标量根为 1）。 */
  maxDepth: number;
}

/** 统计：显式栈迭代遍历（深嵌套不爆栈）。 */
export function buildStats(value: unknown, rawText: string): JsonStats {
  let nodeCount = 0;
  let maxDepth = 1;
  const stack: Array<{ v: unknown; d: number }> = [{ v: value, d: 1 }];
  while (stack.length > 0) {
    const { v, d } = stack.pop() as { v: unknown; d: number };
    nodeCount += 1;
    if (d > maxDepth) maxDepth = d;
    if (Array.isArray(v)) {
      for (const item of v) stack.push({ v: item, d: d + 1 });
    } else if (v !== null && typeof v === "object") {
      for (const key of Object.keys(v as Record<string, unknown>)) {
        stack.push({ v: (v as Record<string, unknown>)[key], d: d + 1 });
      }
    }
  }
  return {
    bytes: new TextEncoder().encode(rawText).length,
    topType: valueTypeOf(value),
    nodeCount,
    maxDepth,
  };
}

/** 内置示例数据（空态一键填充，覆盖全部类型与常见排版特征）。 */
export const EXAMPLE_JSON = `{
  "name": "GaubeeOS",
  "version": "1.0.0",
  "description": "粘贴任意 JSON 试试；这份示例覆盖了所有类型。",
  "features": ["json-viewer", "terminal", "skill-graph"],
  "stats": { "apps": 14, "tests": 445, "stable": true },
  "author": {
    "name": "Gaubee",
    "site": "https://gaubee.com",
    "bio": "一行很长的文字用来演示长字符串的截断与展开：昨天夜里我数了一遍项目里的花括号，数到一半睡着了，梦里它们还在成对地出现，醒来后发现真的少了一对，于是这行文字只好被拉得更长一些，好让你能亲眼看到超过一百二十个字符之后的省略号与展开按钮，这就是你此刻看到的效果。"
  },
  "tags": [1, 2.5, null, true, false],
  "escape\\u6f22\\u5b57": "换行\\n制表\\t引号\\"反斜杠\\\\emoji 🎉 中文",
  "empty": {},
  "emptyList": []
}`;

// ---------------------------------------------------------------------------
// 错误定位：轻量 JSON 校验器（RFC 8259 递归下降）
// ---------------------------------------------------------------------------

function locateError(text: string): JsonErrorInfo {
  if (text.trim() === "") {
    return makeError(text, 0, "EMPTY_INPUT", "没有可解析的内容");
  }
  const cursor = { i: 0 };
  const err = validateValue(text, cursor, 1);
  if (err) return err;
  skipWs(text, cursor);
  if (cursor.i < text.length) {
    return makeError(text, cursor.i, "TRAILING_CONTENT", "JSON 值已经结束，但后面还有多余内容");
  }
  return makeError(text, 0, "UNKNOWN", "解析失败（引擎报错，但未定位到具体语法问题）");
}

function skipWs(text: string, cursor: { i: number }): void {
  while (cursor.i < text.length) {
    const ch = text[cursor.i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") cursor.i += 1;
    else break;
  }
}

function makeError(
  text: string,
  index: number,
  code: JsonErrorCode,
  message: string,
): JsonErrorInfo {
  const { line, column } = lineColOf(text, index);
  return {
    code,
    message,
    suggestion: suggestFix(code, message, text, index),
    line,
    column,
    excerpt: excerptAt(text, line, column),
  };
}

/** 把语法错误翻译成下一步可执行的修复动作。 */
function suggestFix(code: JsonErrorCode, message: string, text: string, index: number): string {
  if (message.includes("单引号") || message.includes("中文引号")) {
    return '把字符串或键名两侧的引号替换为英文双引号（"）。';
  }
  if (code === "EXPECTED_KEY" && text[index] === "}") {
    return "对象最后一项后多了一个逗号，请删除这个逗号。";
  }
  if (code === "EXPECTED_VALUE" && text[index] === "]") {
    return "数组最后一项后多了一个逗号，请删除这个逗号。";
  }
  if (message.includes("缺少逗号")) {
    return "在相邻的键值或数组元素之间补一个逗号（,）。";
  }
  if (message.includes("没有闭合") || message.includes("缺少收尾")) {
    return "检查末尾是否补齐对应的右括号或双引号。";
  }
  if (message.includes("括号不匹配")) {
    return "检查花括号 {} 与方括号 [] 是否成对、顺序正确。";
  }
  if (code === "EXPECTED_COLON") {
    return "在键名后补一个冒号（:），再填写它对应的值。";
  }
  if (code === "INVALID_ESCAPE" || code === "BARE_CONTROL_IN_STRING") {
    return "字符串里的反斜杠和换行需要使用 JSON 转义写法，例如 \\n。";
  }
  if (code === "INVALID_NUMBER") {
    return "检查数字格式：不要有前导零，小数点和指数后必须跟数字。";
  }
  if (code === "TRAILING_CONTENT") {
    return "JSON 只能包含一个根值，请删除根值后面的多余内容。";
  }
  if (code === "TOO_DEEP") {
    return "减少嵌套层级，或先拆分数据后分别查看。";
  }
  return "从定位的行列开始检查括号、逗号和引号是否完整。";
}

function lineColOf(text: string, index: number): { line: number; column: number } {
  if (index <= 0) return { line: index === 0 ? 1 : 0, column: index === 0 ? 1 : 0 };
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text[i] === "\n") {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, column: index - lineStart + 1 };
}

const EXCERPT_LIMIT = 160;
const EXCERPT_WINDOW = 60;

/** 取出错行摘录；超长行围绕出错列开窗截断（两侧加省略号）。 */
function excerptAt(text: string, line: number, column: number): string {
  if (line < 1) return "";
  const lines = text.split("\n");
  const raw = lines[line - 1] ?? "";
  if (raw.length <= EXCERPT_LIMIT) return raw;
  const center = Math.max(0, column - 1);
  let start = Math.max(0, center - EXCERPT_WINDOW);
  let end = Math.min(raw.length, center + EXCERPT_WINDOW);
  // 出错点在行尾时窗口后探，尽量填满上下文
  if (end - start < EXCERPT_WINDOW * 2 && start > 0) start = Math.max(0, end - EXCERPT_WINDOW * 2);
  const head = start > 0 ? "…" : "";
  const tail = end < raw.length ? "…" : "";
  return `${head}${raw.slice(start, end)}${tail}`.trimEnd();
}

function validateValue(text: string, cursor: { i: number }, depth: number): JsonErrorInfo | null {
  if (depth > MAX_DEPTH) {
    return makeError(text, cursor.i, "TOO_DEEP", `嵌套超过 ${MAX_DEPTH} 层，无法解析`);
  }
  skipWs(text, cursor);
  if (cursor.i >= text.length) {
    return makeError(text, cursor.i, "EXPECTED_VALUE", "这里应该有一个值，但输入提前结束了");
  }
  const ch = text[cursor.i];
  if (ch === "{") return validateObject(text, cursor, depth);
  if (ch === "[") return validateArray(text, cursor, depth);
  if (ch === '"') return validateString(text, cursor);
  if (ch === "-" || (ch >= "0" && ch <= "9")) return validateNumber(text, cursor);
  if (matchLiteral(text, cursor, "true")) return null;
  if (matchLiteral(text, cursor, "false")) return null;
  if (matchLiteral(text, cursor, "null")) return null;
  if (ch === "}" || ch === "]" || ch === ",") {
    return makeError(text, cursor.i, "EXPECTED_VALUE", "这里缺少一个值（逗号/括号前不能是空的）");
  }
  return makeError(
    text,
    cursor.i,
    "UNEXPECTED_CHAR",
    ch === "'" || ch === "”" || ch === "「"
      ? "出现了不合法的字符：JSON 的字符串只能用双引号（不能用单引号或中文引号）"
      : "出现了不合法的字符，无法作为 JSON 值的开始",
  );
}

function matchLiteral(text: string, cursor: { i: number }, word: string): boolean {
  if (text.startsWith(word, cursor.i)) {
    cursor.i += word.length;
    return true;
  }
  // 近似前缀（如 "tru"）不吞：留给通用错误定位在正确位置报错
  return false;
}

function validateObject(text: string, cursor: { i: number }, depth: number): JsonErrorInfo | null {
  cursor.i += 1; // '{'
  skipWs(text, cursor);
  if (cursor.i < text.length && text[cursor.i] === "}") {
    cursor.i += 1;
    return null;
  }
  for (;;) {
    skipWs(text, cursor);
    if (cursor.i >= text.length) {
      return makeError(
        text,
        cursor.i,
        "EXPECTED_KEY",
        "对象缺少键（JSON 的键必须是用双引号包起来的字符串）",
      );
    }
    if (text[cursor.i] !== '"') {
      const ch = text[cursor.i];
      return makeError(
        text,
        cursor.i,
        "EXPECTED_KEY",
        ch === "'" || ch === "”" || ch === "「" || ch === "『"
          ? '对象的键必须用双引号（"）包起来，不能用单引号或中文引号'
          : "对象的键必须是用双引号包起来的字符串",
      );
    }
    const keyErr = validateString(text, cursor);
    if (keyErr) return keyErr;
    skipWs(text, cursor);
    if (cursor.i >= text.length || text[cursor.i] !== ":") {
      return makeError(text, cursor.i, "EXPECTED_COLON", "键的后面缺少冒号（:）");
    }
    cursor.i += 1;
    const valueErr = validateValue(text, cursor, depth + 1);
    if (valueErr) return valueErr;
    skipWs(text, cursor);
    if (cursor.i >= text.length) {
      return makeError(
        text,
        cursor.i,
        "EXPECTED_COMMA_OR_CLOSE",
        "对象没有闭合，缺少逗号（,）或右花括号（}）",
      );
    }
    const ch = text[cursor.i];
    if (ch === ",") {
      cursor.i += 1;
      continue;
    }
    if (ch === "}") {
      cursor.i += 1;
      return null;
    }
    return makeError(
      text,
      cursor.i,
      "EXPECTED_COMMA_OR_CLOSE",
      ch === "]" || ch === "}" ? "这里的括号不匹配" : "缺少逗号（,）或右花括号（}）",
    );
  }
}

function validateArray(text: string, cursor: { i: number }, depth: number): JsonErrorInfo | null {
  cursor.i += 1; // '['
  skipWs(text, cursor);
  if (cursor.i < text.length && text[cursor.i] === "]") {
    cursor.i += 1;
    return null;
  }
  for (;;) {
    const valueErr = validateValue(text, cursor, depth + 1);
    if (valueErr) return valueErr;
    skipWs(text, cursor);
    if (cursor.i >= text.length) {
      return makeError(
        text,
        cursor.i,
        "EXPECTED_COMMA_OR_CLOSE",
        "数组没有闭合，缺少逗号（,）或右方括号（]）",
      );
    }
    const ch = text[cursor.i];
    if (ch === ",") {
      cursor.i += 1;
      continue;
    }
    if (ch === "]") {
      cursor.i += 1;
      return null;
    }
    return makeError(text, cursor.i, "EXPECTED_COMMA_OR_CLOSE", "缺少逗号（,）或右方括号（]）");
  }
}

const ESCAPE_ALLOWED = new Set(['"', "\\", "/", "b", "f", "n", "r", "t", "u"]);

/** 校验字符串；调用方保证 cursor.i 当前指向开头的双引号。 */
function validateString(text: string, cursor: { i: number }): JsonErrorInfo | null {
  cursor.i += 1; // 开引号
  for (;;) {
    if (cursor.i >= text.length) {
      return makeError(text, cursor.i, "UNTERMINATED_STRING", '字符串缺少收尾的双引号（"）');
    }
    const ch = text[cursor.i];
    if (ch === '"') {
      cursor.i += 1;
      return null;
    }
    if (ch === "\\") {
      cursor.i += 1;
      if (cursor.i >= text.length) {
        return makeError(text, cursor.i, "UNTERMINATED_STRING", '字符串缺少收尾的双引号（"）');
      }
      const esc = text[cursor.i];
      if (!ESCAPE_ALLOWED.has(esc)) {
        return makeError(
          text,
          cursor.i,
          "INVALID_ESCAPE",
          `转义符 \\ 后不能跟「${esc}」（合法：\\" \\\\ \\/ \\b \\f \\n \\r \\t \\uXXXX）`,
        );
      }
      if (esc === "u") {
        for (let k = 1; k <= 4; k += 1) {
          const hex = text[cursor.i + k];
          if (hex === undefined || !isHexDigit(hex)) {
            return makeError(
              text,
              cursor.i + k,
              "INVALID_ESCAPE",
              "\\u 转义后面必须跟 4 位十六进制数字",
            );
          }
        }
        cursor.i += 4;
      }
      cursor.i += 1;
      continue;
    }
    const code = ch.charCodeAt(0);
    if (code < 0x20) {
      return makeError(
        text,
        cursor.i,
        "BARE_CONTROL_IN_STRING",
        ch === "\n"
          ? "字符串里出现了裸换行：JSON 字符串不能直接换行（需要用 \\n）"
          : "字符串里出现了未转义的控制字符",
      );
    }
    cursor.i += 1;
  }
}

function isHexDigit(ch: string): boolean {
  return (ch >= "0" && ch <= "9") || (ch >= "a" && ch <= "f") || (ch >= "A" && ch <= "F");
}

function validateNumber(text: string, cursor: { i: number }): JsonErrorInfo | null {
  const start = cursor.i;
  if (text[cursor.i] === "-") {
    cursor.i += 1;
    if (cursor.i >= text.length || !isDigit(text[cursor.i])) {
      return makeError(text, cursor.i, "INVALID_NUMBER", "负号（-）后面必须紧跟数字");
    }
  }
  // 整数部分：0 或 [1-9]\d*，前导零非法
  if (text[cursor.i] === "0") {
    cursor.i += 1;
    if (cursor.i < text.length && isDigit(text[cursor.i])) {
      return makeError(
        text,
        cursor.i,
        "INVALID_NUMBER",
        "数字不能以 0 开头（如 01 不合法，应写 1）",
      );
    }
  } else {
    while (cursor.i < text.length && isDigit(text[cursor.i])) cursor.i += 1;
  }
  // 小数部分
  if (cursor.i < text.length && text[cursor.i] === ".") {
    cursor.i += 1;
    if (cursor.i >= text.length || !isDigit(text[cursor.i])) {
      return makeError(text, cursor.i, "INVALID_NUMBER", "小数点（.）后面必须紧跟数字");
    }
    while (cursor.i < text.length && isDigit(text[cursor.i])) cursor.i += 1;
  }
  // 指数部分
  if (cursor.i < text.length && (text[cursor.i] === "e" || text[cursor.i] === "E")) {
    cursor.i += 1;
    if (cursor.i < text.length && (text[cursor.i] === "+" || text[cursor.i] === "-")) {
      cursor.i += 1;
    }
    if (cursor.i >= text.length || !isDigit(text[cursor.i])) {
      return makeError(text, cursor.i, "INVALID_NUMBER", "指数记号（e/E）后面必须跟数字");
    }
    while (cursor.i < text.length && isDigit(text[cursor.i])) cursor.i += 1;
  }
  if (cursor.i === start) {
    return makeError(text, cursor.i, "INVALID_NUMBER", "这里不是一个合法的数字");
  }
  return null;
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}
