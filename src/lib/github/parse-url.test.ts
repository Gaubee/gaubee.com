/**
 * parseGithubUrl 单元测试。
 *
 * 验证各种 GitHub URL 格式的解析：
 * - 完整 https URL（含/不含 branch、path）
 * - git@ SSH URL
 * - owner/repo 短格式
 * - 非 GitHub 链接返回 null
 */
import { describe, expect, it } from "vitest";

import { parseGithubUrl } from "./parse-url";

describe("parseGithubUrl", () => {
  it("完整 https URL（仅 owner/repo）", () => {
    const result = parseGithubUrl("https://github.com/gaubee/gaubee.com");
    expect(result).toEqual({ owner: "gaubee", repo: "gaubee.com" });
  });

  it("完整 https URL 含 tree/branch", () => {
    const result = parseGithubUrl("https://github.com/gaubee/gaubee.com/tree/dev");
    expect(result).toEqual({ owner: "gaubee", repo: "gaubee.com", branch: "dev" });
  });

  it("完整 https URL 含 tree/branch/path", () => {
    const result = parseGithubUrl("https://github.com/gaubee/gaubee.com/tree/main/src/lib/x.ts");
    expect(result).toEqual({
      owner: "gaubee",
      repo: "gaubee.com",
      branch: "main",
      path: "src/lib/x.ts",
    });
  });

  it("完整 https URL 含 blob/branch/path（文件视图）", () => {
    const result = parseGithubUrl("https://github.com/sveltejs/svelte/blob/main/package.json");
    expect(result).toEqual({
      owner: "sveltejs",
      repo: "svelte",
      branch: "main",
      path: "package.json",
    });
  });

  it("owner/repo 短格式", () => {
    const result = parseGithubUrl("gaubee/gaubee.com");
    expect(result).toEqual({ owner: "gaubee", repo: "gaubee.com" });
  });

  it("git@ SSH URL（含 committish）", () => {
    const result = parseGithubUrl("git@github.com:gaubee/gaubee.com.git@dev");
    expect(result).toEqual({
      owner: "gaubee",
      repo: "gaubee.com",
      branch: "dev",
    });
  });

  it("非 GitHub 链接返回 null", () => {
    expect(parseGithubUrl("https://gitlab.com/gaubee/gaubee.com")).toBeNull();
    expect(parseGithubUrl("https://example.com")).toBeNull();
  });

  it("空字符串返回 null", () => {
    expect(parseGithubUrl("")).toBeNull();
    expect(parseGithubUrl("   ")).toBeNull();
  });

  it("URL 含特殊字符的路径正确解码", () => {
    const result = parseGithubUrl(
      "https://github.com/gaubee/gaubee.com/tree/main/src/带空格 文件.ts",
    );
    expect(result?.path).toBe("src/带空格 文件.ts");
  });
});
