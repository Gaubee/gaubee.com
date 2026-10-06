import { describe, expect, it } from "vitest";

import { inferJsonSchema, inferTypeScript, jsonToYaml, yamlToJson } from "./transform";

describe("YAML 转换", () => {
  it("JSON → YAML → JSON 保留结构", () => {
    const value = { name: "Gaubee", enabled: true, tags: ["json", "yaml"] };
    const yaml = jsonToYaml(value);
    expect(yaml).toContain("name: Gaubee");
    expect(yamlToJson(yaml)).toEqual({ ok: true, value });
  });

  it("返回人话化的 YAML 错误", () => {
    const result = yamlToJson("name: [");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("unexpected end");
  });
});

describe("TypeScript 类型推断", () => {
  it("生成嵌套 interface 与数组类型", () => {
    const result = inferTypeScript({ user: { name: "Ada" }, tags: ["a", "b"] });
    expect(result).toContain("interface Root");
    expect(result).toContain("interface RootUser");
    expect(result).toContain("user: RootUser");
    expect(result).toContain("tags: string[]");
  });

  it("复杂键名使用引号", () => {
    expect(inferTypeScript({ "display-name": 1 })).toContain('"display-name": number;');
  });
});

describe("JSON Schema 推断", () => {
  it("生成对象属性、required 和数组 items", () => {
    const schema = inferJsonSchema({ id: 1, labels: ["a"] });
    expect(schema.$schema).toContain("2020-12");
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(["id", "labels"]);
    expect((schema.properties as Record<string, unknown>).labels).toEqual({
      title: "RootLabels",
      type: "array",
      items: { title: "RootLabelsItem", type: "string" },
    });
  });
});
