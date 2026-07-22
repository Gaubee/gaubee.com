/**
 * path-utils 单元测试：pathToTabIdSafe 路径匹配。
 */
import { describe, expect, it } from "vitest";
import { pathToTabIdSafe } from "./path-utils";

describe("pathToTabIdSafe", () => {
  const tabs = ["/app/articles", "/app/github", "/app/terminal"] as const;

  it("精确匹配返回对应 tab", () => {
    expect(pathToTabIdSafe("/app/articles", tabs)).toBe("/app/articles");
    expect(pathToTabIdSafe("/app/github", tabs)).toBe("/app/github");
  });

  it("子路径匹配父 tab（path 以 tab + / 开头）", () => {
    expect(pathToTabIdSafe("/app/articles/0001", tabs)).toBe("/app/articles");
    expect(pathToTabIdSafe("/app/github/owner/repo", tabs)).toBe("/app/github");
  });

  it("无匹配返回 null", () => {
    expect(pathToTabIdSafe("/app/unknown", tabs)).toBeNull();
    expect(pathToTabIdSafe("/", tabs)).toBeNull();
    expect(pathToTabIdSafe("", tabs)).toBeNull();
  });

  it("前缀相似但不构成父子关系的不误匹配", () => {
    // /app/articles-archive 不应匹配 /app/articles（因为没有 / 分隔）
    expect(pathToTabIdSafe("/app/articles-archive", tabs)).toBeNull();
    // 但 /app/articles/xxx 应匹配
    expect(pathToTabIdSafe("/app/articles/xxx", tabs)).toBe("/app/articles");
  });

  it("空 tab 列表返回 null", () => {
    expect(pathToTabIdSafe("/app/articles", [])).toBeNull();
  });

  it("返回第一个匹配的 tab（列表顺序优先）", () => {
    // 若两个 tab 都可能匹配（理论上不会，因为 tab 是唯一路径），取第一个
    const dup = ["/app/a", "/app/a/b"] as const;
    expect(pathToTabIdSafe("/app/a", dup)).toBe("/app/a");
    expect(pathToTabIdSafe("/app/a/b", dup)).toBe("/app/a"); // /app/a 先匹配
  });
});
