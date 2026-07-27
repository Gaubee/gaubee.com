/**
 * path-pattern 单测：编译与拼接。
 */
import { describe, expect, it } from "vitest";

import { compilePattern, joinPattern, stringifyPattern } from "../path-pattern";

describe("compilePattern", () => {
  it("index pattern（空串）匹配空路径或单独斜杠", () => {
    const c = compilePattern("");
    expect(c.regex.test("")).toBe(true);
    expect(c.regex.test("/")).toBe(true);
    expect(c.regex.test("foo")).toBe(false);
    expect(c.paramNames).toEqual([]);
  });

  it("静态段：严格匹配", () => {
    const c = compilePattern("repo");
    expect(c.regex.test("repo")).toBe(true);
    expect(c.regex.test("rep")).toBe(false);
    expect(c.regex.test("repo/")).toBe(true); // 容忍尾斜杠
    expect(c.regex.test("repo/foo")).toBe(false);
  });

  it("单参数：捕获", () => {
    const c = compilePattern(":owner");
    expect(c.regex.test("gaubee")).toBe(true);
    expect(c.regex.test("")).toBe(false);
    expect(c.paramNames).toEqual(["owner"]);
  });

  it("多段静态+参数混合", () => {
    const c = compilePattern("repo/:owner/:repo");
    expect(c.regex.test("repo/a/b")).toBe(true);
    expect(c.regex.test("repo/a/b/")).toBe(true);
    expect(c.regex.test("repo/a")).toBe(false);
    expect(c.regex.test("repo/a/b/c")).toBe(false);
    expect(c.paramNames).toEqual(["owner", "repo"]);
  });

  it("容忍 URI 编码的参数值（由 match 负责解码，正则只校验结构）", () => {
    const c = compilePattern(":path");
    // 含 '/' 仍应不匹配（路径段不能跨段）
    expect(c.regex.test("foo/bar")).toBe(false);
    expect(c.regex.test("foo%2Fbar")).toBe(true);
  });
});

describe("joinPattern", () => {
  it("父绝对 + 子相对", () => {
    expect(joinPattern("/app/github", "repo/:o/:r")).toBe("/app/github/repo/:o/:r");
  });

  it("子空串：返回父", () => {
    expect(joinPattern("/app/github", "")).toBe("/app/github");
  });

  it("父尾斜杠容忍", () => {
    expect(joinPattern("/app/github/", "repo")).toBe("/app/github/repo");
  });

  it("子首尾斜杠容忍", () => {
    expect(joinPattern("/app/github", "/repo/")).toBe("/app/github/repo");
  });
});

describe("stringifyPattern", () => {
  it("替换 :param", () => {
    expect(stringifyPattern("repo/:o/:r", { o: "a", r: "b" })).toBe("repo/a/b");
  });

  it("encodeURIComponent 编码特殊字符", () => {
    expect(stringifyPattern(":name", { name: "foo bar" })).toBe("foo%20bar");
  });

  it("缺失参数：保留 :name（DEV 警告）", () => {
    expect(stringifyPattern("repo/:o/:r", { o: "a" })).toBe("repo/a/:r");
  });

  it("多余 key 被忽略", () => {
    expect(stringifyPattern("repo/:o", { o: "a", extra: "x" })).toBe("repo/a");
  });
});
