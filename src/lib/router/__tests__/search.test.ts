/**
 * search 单测：序列化与反序列化。
 */
import { describe, expect, it } from "vitest";

import { parseSearchString, stringifySearch } from "../search";

describe("parseSearchString", () => {
  it("空串返回空对象", () => {
    expect(parseSearchString("")).toEqual({});
  });

  it("含 ? 前缀容忍", () => {
    expect(parseSearchString("?a=1&b=2")).toEqual({ a: "1", b: "2" });
  });

  it("无 ? 前缀", () => {
    expect(parseSearchString("a=1&b=2")).toEqual({ a: "1", b: "2" });
  });

  it("值保持 string 类型（交给 zod 做 coerce）", () => {
    expect(parseSearchString("count=42&enabled=true")).toEqual({
      count: "42",
      enabled: "true",
    });
  });

  it("URI 解码", () => {
    expect(parseSearchString("name=foo%20bar")).toEqual({ name: "foo bar" });
  });

  it("空值", () => {
    expect(parseSearchString("a=&b=2")).toEqual({ a: "", b: "2" });
  });
});

describe("stringifySearch", () => {
  it("空对象返回空串", () => {
    expect(stringifySearch({})).toBe("");
  });

  it("基础序列化", () => {
    expect(stringifySearch({ a: "1", b: "2" })).toBe("?a=1&b=2");
  });

  it("number / boolean 转 string", () => {
    expect(stringifySearch({ count: 42, enabled: true })).toBe("?count=42&enabled=true");
  });

  it("null / undefined 跳过", () => {
    expect(stringifySearch({ a: "1", b: null, c: undefined })).toBe("?a=1");
  });

  it("特殊字符编码", () => {
    expect(stringifySearch({ name: "foo bar" })).toBe("?name=foo+bar");
  });
});
