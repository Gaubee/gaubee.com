import { describe, expect, it } from "vitest";

import { formatJsonPath, parseJsonPath, queryJson } from "./query";

const value = {
  user: { name: "Ada", contacts: [{ type: "email", value: "ada@example.com" }] },
  admin: { name: "Grace" },
  nested: { user: { name: "Lin" } },
};

describe("parseJsonPath", () => {
  it("解析属性、下标和通配符", () => {
    expect(parseJsonPath("$.user.contacts[0].value")).toEqual({
      ok: true,
      tokens: [
        { kind: "property", key: "user" },
        { kind: "property", key: "contacts" },
        { kind: "index", index: 0 },
        { kind: "property", key: "value" },
      ],
    });
    expect(parseJsonPath("$.user.*")).toEqual({
      ok: true,
      tokens: [{ kind: "property", key: "user" }, { kind: "wildcard" }],
    });
  });

  it("支持带引号的复杂键名和递归下降", () => {
    expect(parseJsonPath('$["display-name"]')).toEqual({
      ok: true,
      tokens: [{ kind: "property", key: "display-name" }],
    });
    expect(parseJsonPath("$..name")).toEqual({
      ok: true,
      tokens: [{ kind: "recursive", key: "name" }],
    });
  });

  it("拒绝不完整路径", () => {
    expect(parseJsonPath("user.name").ok).toBe(false);
    expect(parseJsonPath("$.user[").ok).toBe(false);
    expect(parseJsonPath("$.user.").ok).toBe(false);
  });
});

describe("queryJson", () => {
  it("返回值与完整路径", () => {
    const result = queryJson(value, "$.user.contacts[0].value");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.matches).toEqual([
        { path: ["user", "contacts", 0, "value"], value: "ada@example.com" },
      ]);
    }
  });

  it("支持通配符与递归下降", () => {
    const wildcard = queryJson(value, "$.user.contacts[*].type");
    expect(wildcard.ok && wildcard.matches.map((match) => match.value)).toEqual(["email"]);
    const recursive = queryJson(value, "$..name");
    expect(recursive.ok && recursive.matches.map((match) => match.value)).toEqual([
      "Ada",
      "Grace",
      "Lin",
    ]);
  });

  it("没有匹配时返回空列表", () => {
    const result = queryJson(value, "$.missing");
    expect(result.ok && result.matches).toEqual([]);
  });
});

describe("formatJsonPath", () => {
  it("输出可读路径并转义复杂键名", () => {
    expect(formatJsonPath(["user", "contacts", 0, "value"])).toBe("$.user.contacts[0].value");
    expect(formatJsonPath(["display-name"])).toBe('$["display-name"]');
  });
});
