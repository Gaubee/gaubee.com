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

  it("根数组生成 item interface", () => {
    const result = inferTypeScript([{ name: "Ada" }]);
    expect(result).toContain("interface RootItem");
    expect(result).toContain("type Root = RootItem[];");
    expect(result).toContain("name: string;");
  });

  it("异构对象数组合并字段并标记可选键", () => {
    const result = inferTypeScript([{ a: 1 }, { b: "x" }]);
    expect(result).toContain("interface RootItem");
    expect(result).toContain("a?: number;");
    expect(result).toContain("b?: string;");
    expect(result).toContain("type Root = RootItem[];");
  });

  it("同名异形嵌套接口自动编号，大小写冲突不覆盖", () => {
    const result = inferTypeScript({ a: { value: 1 }, A: { value: "x" } });
    expect(result).toContain("a: RootA");
    expect(result).toContain("A: RootA2");
    expect(result).toContain("interface RootA {");
    expect(result).toContain("interface RootA2 {");
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
