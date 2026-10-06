import FileJson from "@lucide/svelte/icons/file-json";
/**
 * AppManager 默认应用增量迁移测试（浏览器环境，runes + 真实 localStorage）。
 *
 * 验证：DEFAULT_APP_IDS 新增应用（json-viewer）对老用户一次性补装；
 * 补装只跑一次（用户事后卸载不被覆盖）；首次访问用户走默认安装路径。
 */
import { beforeEach, describe, expect, it } from "vitest";

import { AppManager } from "./AppManager.svelte";
import type { AppEntry } from "./types";

const STORAGE_KEY = "gaubee:os:apps";
const MIGRATIONS_KEY = "gaubee:os:apps-default-migrations";

function makeEntry(id: string): AppEntry {
  return {
    manifest: {
      id,
      name: id,
      icon: FileJson,
      category: "default",
      defaultArea: "main",
      activities: [{ pattern: `/app/${id}`, entry: true, root: { id, pattern: "" } as never }],
    },
  };
}

function freshManager(): AppManager {
  const manager = new AppManager();
  manager.register(makeEntry("github"));
  manager.register(makeEntry("json-viewer"));
  return manager;
}

beforeEach(() => {
  localStorage.clear();
});

describe("默认应用增量迁移（json-viewer 补装）", () => {
  it("老用户（有持久化、无 json-viewer）init 后被一次性补装", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["github"]));
    const manager = freshManager();
    manager.init();
    expect(manager.isInstalled("github")).toBe(true);
    expect(manager.isInstalled("json-viewer")).toBe(true);
    // 迁移标记落盘 + 补装结果持久化
    expect(JSON.parse(localStorage.getItem(MIGRATIONS_KEY) ?? "[]")).toContain(
      "add-json-viewer@2026-10-06",
    );
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")).toContain("json-viewer");
  });

  it("迁移只跑一次：用户事后卸载 json-viewer，再次 init 不被再次补装", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["github"]));
    freshManager().init();

    // 用户主动卸载
    const after = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as string[];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(after.filter((id) => id !== "json-viewer")));

    // 新会话（新实例，同 localStorage）
    const manager2 = freshManager();
    manager2.init();
    expect(manager2.isInstalled("json-viewer")).toBe(false);
    expect(manager2.isInstalled("github")).toBe(true);
  });

  it("首次访问用户走默认安装路径（行为不变）", () => {
    const manager = freshManager();
    manager.init();
    expect(manager.isInstalled("github")).toBe(true);
    expect(manager.isInstalled("json-viewer")).toBe(true);
    expect(localStorage.getItem(MIGRATIONS_KEY)).toContain("add-json-viewer@2026-10-06");
  });

  it("迁移标记已存在时不重复执行", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(["github"]));
    localStorage.setItem(MIGRATIONS_KEY, JSON.stringify(["add-json-viewer@2026-10-06"]));
    const manager = freshManager();
    manager.init();
    expect(manager.isInstalled("json-viewer")).toBe(false);
  });
});
