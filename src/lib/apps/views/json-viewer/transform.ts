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
    return { ok: true, value: load(text) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "YAML 解析失败" };
  }
}

/** 从 JSON 值推断 TypeScript interface/type 声明。 */
export function inferTypeScript(value: unknown, rootName = "Root"): string {
  const interfaces = new Map<string, string>();
  const rootType = renderTsType(value, rootName, interfaces);
  if (interfaces.has(rootName)) return [...interfaces.values()].join("\n\n");
  return `type ${rootName} = ${rootType};`;
}

/** 从 JSON 值推断 JSON Schema（draft 2020-12）。 */
export function inferJsonSchema(value: unknown): Record<string, unknown> {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    ...schemaFor(value, "Root"),
  };
}

function renderTsType(value: unknown, name: string, interfaces: Map<string, string>): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    if (value.length === 0) return "unknown[]";
    const itemTypes = [...new Set(value.map((item) => renderTsType(item, `${name}Item`, interfaces)))];
    return itemTypes.length === 1 ? `${itemTypes[0]}[]` : `(${itemTypes.join(" | ")})[]`;
  }
  switch (typeof value) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "object": {
      if (!isRecord(value)) return "unknown";
      if (!interfaces.has(name)) interfaces.set(name, "");
      const fields = Object.entries(value).map(([key, child]) => {
        const childName = `${name}${toPascalCase(key)}`;
        return `  ${quoteTsKey(key)}: ${renderTsType(child, childName, interfaces)};`;
      });
      interfaces.set(name, `interface ${name} {\n${fields.join("\n")}\n}`);
      return name;
    }
    default:
      return "unknown";
  }
}

function schemaFor(value: unknown, title: string): Record<string, unknown> {
  if (value === null) return { title, type: "null" };
  if (Array.isArray(value)) {
    const itemSchemas = value.map((item) => schemaFor(item, `${title}Item`));
    const unique = uniqueSchemas(itemSchemas);
    return unique.length <= 1 ? { title, type: "array", items: unique[0] ?? {} } : { title, type: "array", prefixItems: unique };
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
