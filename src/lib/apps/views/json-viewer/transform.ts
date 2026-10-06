/**
 * JSON 转换纯逻辑（无 DOM 依赖，server project 可测）。
 * 负责 YAML 往返、TypeScript 类型生成和 JSON Schema 推断，视图只编排展示与复制。
 */

import { dump, load } from "js-yaml";

export interface YamlParseOutcome {
  ok: true;
  value: unknown;
}

export interface YamlParseError {
  ok: false;
  error: string;
}

/** 将 JSON.parse 产物转为稳定、无引用别名的 YAML。 */
export function jsonToYaml(value: unknown): string {
  return dump(value, { noRefs: true, lineWidth: -1 });
}

/** 将 YAML 解析为可供 JSON 树消费的值。 */
export function yamlToJson(text: string): YamlParseOutcome | YamlParseError {
  try {
    const value = load(text);
    if (JSON.stringify(value) === undefined) {
      return { ok: false, error: "YAML 结果不是可转换的 JSON 值" };
    }
    return { ok: true, value };
  } catch (error) {
    if (error instanceof TypeError && error.message.toLowerCase().includes("circular")) {
      return { ok: false, error: "YAML 包含循环引用，无法转换为 JSON" };
    }
    return { ok: false, error: error instanceof Error ? error.message : "YAML 解析失败" };
  }
}

/** 从 JSON 值推断 TypeScript interface/type 声明。 */
export function inferTypeScript(value: unknown, rootName = "Root"): string {
  const registry = new TypeRegistry();
  const rootType = registry.render(value, rootName);
  const declarations = registry.declarations();
  if (rootType === rootName && registry.has(rootName)) return declarations.join("\n\n");
  return [...declarations, `type ${rootName} = ${rootType};`].filter(Boolean).join("\n\n");
}

/** 从 JSON 值推断 JSON Schema（draft 2020-12）。 */
export function inferJsonSchema(value: unknown): Record<string, unknown> {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    ...schemaFor(value, "Root"),
  };
}

interface ObjectShape {
  fields: Map<string, readonly unknown[]>;
  optionalKeys: ReadonlySet<string>;
}

/** 为对象类型分配稳定、无覆盖的 interface 名称。 */
class TypeRegistry {
  private readonly interfaces = new Map<string, string>();
  private readonly namesByShape = new Map<string, string>();
  private readonly nextSuffix = new Map<string, number>();

  has(name: string): boolean {
    return this.interfaces.has(name);
  }

  declarations(): string[] {
    return [...this.interfaces.values()].filter(Boolean);
  }

  render(value: unknown, name: string): string {
    if (value === null) return "null";
    if (Array.isArray(value)) return this.renderArray(value, name);
    if (isRecord(value)) return this.renderObject(objectShapeFromValues([value]), name);
    switch (typeof value) {
      case "string":
        return "string";
      case "number":
        return "number";
      case "boolean":
        return "boolean";
      default:
        return "unknown";
    }
  }

  private renderArray(items: readonly unknown[], name: string): string {
    if (items.length === 0) return "unknown[]";
    if (items.every(isRecord)) {
      const merged = objectShapeFromValues(items);
      return `${this.renderObject(merged, `${name}Item`)}[]`;
    }
    const itemTypes = unique(items.map((item) => this.render(item, `${name}Item`)));
    return itemTypes.length === 1 ? `${itemTypes[0]}[]` : `(${itemTypes.join(" | ")})[]`;
  }

  private renderObject(shape: ObjectShape, baseName: string): string {
    const shapeId = objectShapeKey(shape);
    const existing = this.namesByShape.get(shapeId);
    if (existing) return existing;

    const name = this.allocateName(baseName);
    this.namesByShape.set(shapeId, name);
    // 先占位，避免递归结构或重复引用时再次分配同名接口。
    this.interfaces.set(name, "");

    const fields = [...shape.fields.entries()].sort(([a], [b]) => a.localeCompare(b));
    const lines = fields.map(([key, values]) => {
      const childName = `${name}${toPascalCase(key)}`;
      const childType = this.renderField(values, childName);
      const optional = shape.optionalKeys.has(key) ? "?" : "";
      return `  ${quoteTsKey(key)}${optional}: ${childType};`;
    });
    this.interfaces.set(name, `interface ${name} {\n${lines.join("\n")}\n}`);
    return name;
  }

  private renderField(values: readonly unknown[], name: string): string {
    if (values.length > 1 && values.every(isRecord)) {
      return this.renderObject(objectShapeFromValues(values), name);
    }
    const types = unique(values.map((value) => this.render(value, name)));
    return types.length === 1 ? types[0] : types.join(" | ");
  }

  private allocateName(baseName: string): string {
    const suffix = this.nextSuffix.get(baseName) ?? 0;
    let index = suffix;
    let candidate = index === 0 ? baseName : `${baseName}${index + 1}`;
    while (this.interfaces.has(candidate)) {
      index += 1;
      candidate = `${baseName}${index + 1}`;
    }
    this.nextSuffix.set(baseName, index + 1);
    return candidate;
  }
}

function objectShapeFromValues(values: readonly Record<string, unknown>[]): ObjectShape {
  const fields = new Map<string, unknown[]>();
  const optionalKeys = new Set<string>();
  const allKeys = new Set(values.flatMap((value) => Object.keys(value)));
  for (const key of allKeys) {
    const present = values.flatMap((value) =>
      Object.prototype.hasOwnProperty.call(value, key) ? [value[key]] : [],
    );
    fields.set(key, present);
    if (present.length < values.length) optionalKeys.add(key);
  }
  return { fields, optionalKeys };
}

function objectShapeKey(shape: ObjectShape): string {
  return JSON.stringify(
    [...shape.fields.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, values]) => [
        key,
        shape.optionalKeys.has(key),
        unique(values.map(valueShapeKey)),
      ]),
  );
}

function valueShapeKey(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `array:${unique(value.map(valueShapeKey)).sort().join(",")}`;
  if (isRecord(value)) return `object:${objectShapeKey(objectShapeFromValues([value]))}`;
  return typeof value;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function schemaFor(value: unknown, title: string): Record<string, unknown> {
  if (value === null) return { title, type: "null" };
  if (Array.isArray(value)) {
    const itemSchemas = value.map((item) => schemaFor(item, `${title}Item`));
    const unique = uniqueSchemas(itemSchemas);
    return unique.length <= 1
      ? { title, type: "array", items: unique[0] ?? {} }
      : { title, type: "array", prefixItems: unique };
  }
  switch (typeof value) {
    case "string":
      return { title, type: "string" };
    case "number":
      return { title, type: "number" };
    case "boolean":
      return { title, type: "boolean" };
    case "object": {
      if (!isRecord(value)) return { title };
      const properties: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value)) {
        properties[key] = schemaFor(child, `${title}${toPascalCase(key)}`);
      }
      return {
        title,
        type: "object",
        properties,
        required: Object.keys(value),
        additionalProperties: false,
      };
    }
    default:
      return { title };
  }
}

function uniqueSchemas(schemas: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  return schemas.filter((schema) => {
    const key = JSON.stringify({ ...schema, title: undefined });
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function quoteTsKey(key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
}

function toPascalCase(key: string): string {
  const words = key.split(/[^A-Za-z0-9_$]+/).filter(Boolean);
  const result = words.map((word) => word[0].toUpperCase() + word.slice(1)).join("");
  return result || "Value";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
