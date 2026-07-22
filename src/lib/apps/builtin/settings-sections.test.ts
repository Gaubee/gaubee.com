/**
 * SettingsSectionRegistry 单元测试。
 *
 * 覆盖：register/unregister/has/all 的 order 排序稳定性。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { settingsSectionsRegistry } from "./settings-sections";

describe("SettingsSectionRegistry", () => {
  beforeEach(() => {
    // 清空：unregister 已知的 id（registry 无 clear，逐个删）
    for (const s of settingsSectionsRegistry.all()) {
      settingsSectionsRegistry.unregister(s.id);
    }
  });

  it("register 后 has 返回 true", () => {
    settingsSectionsRegistry.register({ id: "a", title: "A" });
    expect(settingsSectionsRegistry.has("a")).toBe(true);
    expect(settingsSectionsRegistry.has("b")).toBe(false);
  });

  it("all() 按 order 升序", () => {
    settingsSectionsRegistry.register({ id: "c", title: "C", order: 10 });
    settingsSectionsRegistry.register({ id: "a", title: "A", order: 1 });
    settingsSectionsRegistry.register({ id: "b", title: "B", order: 5 });
    const ids = settingsSectionsRegistry.all().map((s) => s.id);
    expect(ids).toEqual(["a", "b", "c"]);
  });

  it("无 order 排在末尾", () => {
    settingsSectionsRegistry.register({ id: "ordered", title: "O", order: 1 });
    settingsSectionsRegistry.register({ id: "noorder", title: "N" });
    const ids = settingsSectionsRegistry.all().map((s) => s.id);
    expect(ids[0]).toBe("ordered");
    expect(ids[1]).toBe("noorder");
  });

  it("unregister 移除条目", () => {
    settingsSectionsRegistry.register({ id: "a", title: "A" });
    settingsSectionsRegistry.unregister("a");
    expect(settingsSectionsRegistry.has("a")).toBe(false);
  });
});
