import { describe, expect, it } from "vitest";

import { buildStats, EXAMPLE_JSON, parseJson, valueTypeOf, type JsonErrorInfo } from "./json-core";

function expectError(text: string): JsonErrorInfo {
  const outcome = parseJson(text);
  expect(outcome.ok).toBe(false);
  if (outcome.ok) throw new Error("expected parse failure");
  return outcome.error;
}

describe("parseJson 合法输入", () => {
  it("各类型标量与容器", () => {
    expect(parseJson("{}")).toEqual({ ok: true, value: {} });
    expect(parseJson("[]")).toEqual({ ok: true, value: [] });
    expect(parseJson("42")).toEqual({ ok: true, value: 42 });
    expect(parseJson("-1.5e-2")).toEqual({ ok: true, value: -1.5e-2 });
    expect(parseJson('"hi"')).toEqual({ ok: true, value: "hi" });
    expect(parseJson("true")).toEqual({ ok: true, value: true });
    expect(parseJson("null")).toEqual({ ok: true, value: null });
  });

  it("嵌套结构与转义", () => {
    const text = '{"a":[1,{"b":null}],"c":"x\\n\\u4e2d"}';
    const outcome = parseJson(text);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value).toEqual({ a: [1, { b: null }], c: "x\n中" });
    }
  });

  it("空白容忍（前后空白、多行）", () => {
    expect(parseJson('  { "a" : 1 }  \n')).toEqual({ ok: true, value: { a: 1 } });
  });

  it("内置示例自身合法（防示例腐坏）", () => {
    const outcome = parseJson(EXAMPLE_JSON);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const stats = buildStats(outcome.value, EXAMPLE_JSON);
      expect(stats.topType).toBe("object");
      expect(stats.maxDepth).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("parseJson 错误定位", () => {
  it("空输入", () => {
    const err = expectError("   \n  ");
    expect(err.code).toBe("EMPTY_INPUT");
  });

  it("对象尾逗号：行列精确", () => {
    const err = expectError('{"a": 1,}');
    expect(err.code).toBe("EXPECTED_KEY");
    expect(err.line).toBe(1);
    expect(err.column).toBe(9);
  });

  it("多行输入的行号", () => {
    const err = expectError('{\n  "a": 1,\n  b: 2\n}');
    expect(err.code).toBe("EXPECTED_KEY");
    expect(err.line).toBe(3);
    expect(err.column).toBe(3);
  });

  it("键后缺冒号", () => {
    const err = expectError('{"a" 1}');
    expect(err.code).toBe("EXPECTED_COLON");
    expect(err.column).toBe(6);
  });

  it("缺少值", () => {
    const err = expectError('{"a": }');
    expect(err.code).toBe("EXPECTED_VALUE");
    expect(err.column).toBe(7);
  });

  it("键不是字符串", () => {
    const err = expectError("{a: 1}");
    expect(err.code).toBe("EXPECTED_KEY");
    expect(err.column).toBe(2);
  });

  it("字符串未闭合", () => {
    const err = expectError('"abc');
    expect(err.code).toBe("UNTERMINATED_STRING");
    expect(err.column).toBe(5);
  });

  it("非法转义", () => {
    const err = expectError('"a\\q"');
    expect(err.code).toBe("INVALID_ESCAPE");
    expect(err.column).toBe(4);
  });

  it("\\u 转义缺十六进制位", () => {
    const err = expectError('"\\u12g4"');
    expect(err.code).toBe("INVALID_ESCAPE");
  });

  it("字符串内裸换行", () => {
    const err = expectError('"a\nb"');
    expect(err.code).toBe("BARE_CONTROL_IN_STRING");
    expect(err.line).toBe(1);
  });

  it("数组未闭合", () => {
    const err = expectError("[1, 2");
    expect(err.code).toBe("EXPECTED_COMMA_OR_CLOSE");
    expect(err.column).toBe(6);
  });

  it("对象未闭合", () => {
    const err = expectError('{"a": 1');
    expect(err.code).toBe("EXPECTED_COMMA_OR_CLOSE");
  });

  it("前导零数字", () => {
    const err = expectError("01");
    expect(err.code).toBe("INVALID_NUMBER");
    expect(err.column).toBe(2);
  });

  it("负号后缺数字", () => {
    const err = expectError("-");
    expect(err.code).toBe("INVALID_NUMBER");
  });

  it("小数点后缺数字", () => {
    const err = expectError("1.");
    expect(err.code).toBe("INVALID_NUMBER");
  });

  it("单引号键给出专门提示", () => {
    const err = expectError("{'a': 1}");
    expect(err.code).toBe("EXPECTED_KEY");
    expect(err.message).toContain("双引号");
  });

  it("值结束后多余内容", () => {
    const err = expectError('{"a":1} extra');
    expect(err.code).toBe("TRAILING_CONTENT");
    expect(err.column).toBe(9);
  });

  it("中文引号提示", () => {
    const err = expectError("「a」");
    expect(err.code).toBe("UNEXPECTED_CHAR");
    expect(err.message).toContain("双引号");
  });

  it("出错行摘录随错误返回", () => {
    const err = expectError('{\n  "a": 1,\n  b: 2\n}');
    expect(err.excerpt).toBe("  b: 2");
  });

  it("超长行摘录截断（带省略号，长度有界）", () => {
    const long = `{"k":"${"x".repeat(400)}"`;
    const err = expectError(long);
    expect(err.excerpt.length).toBeLessThanOrEqual(170);
    expect(err.excerpt.startsWith("…") || err.excerpt.endsWith("…")).toBe(true);
  });
});

describe("valueTypeOf / buildStats", () => {
  it("valueTypeOf 全覆盖", () => {
    expect(valueTypeOf({})).toBe("object");
    expect(valueTypeOf([])).toBe("array");
    expect(valueTypeOf("s")).toBe("string");
    expect(valueTypeOf(1)).toBe("number");
    expect(valueTypeOf(true)).toBe("boolean");
    expect(valueTypeOf(null)).toBe("null");
  });

  it("buildStats：节点数与深度", () => {
    const text = '{"a":[1,{"b":null}],"c":"x"}';
    const outcome = parseJson(text);
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const stats = buildStats(outcome.value, text);
      // root + a(array) + 1 + {b:null} + null + "x" = 6（键不计节点）
      expect(stats.nodeCount).toBe(6);
      expect(stats.maxDepth).toBe(4);
      expect(stats.topType).toBe("object");
      expect(stats.bytes).toBe(text.length); // 纯 ASCII 时字节等于字符数
    }
  });

  it("buildStats：UTF-8 字节数（中文 3 字节）", () => {
    const outcome = parseJson('"中"');
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(buildStats(outcome.value, '"中"').bytes).toBe(5); // 2 引号 + 3 字节
    }
  });

  it("buildStats：标量根", () => {
    expect(buildStats(42, "42")).toEqual({
      bytes: 2,
      topType: "number",
      nodeCount: 1,
      maxDepth: 1,
    });
  });
});
