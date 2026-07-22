/**
 * AppServiceRegistry 单元测试。
 *
 * 覆盖：同步/异步工厂、懒构造缓存、register/unregisterApp、has/appIdOf。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppServiceNotInstalled, appServiceRegistry } from "./registry";
import type { AppService } from "./types";

/** 构造一个 fake service。 */
function makeService(id: string, appId: string): AppService {
  return { id, appId };
}

describe("AppServiceRegistry", () => {
  beforeEach(() => {
    appServiceRegistry.clear();
  });

  describe("register / has / appIdOf", () => {
    it("register 后 has 返回 true", () => {
      appServiceRegistry.register("app1", {
        foo: () => makeService("foo", "app1"),
      });
      expect(appServiceRegistry.has("foo")).toBe(true);
      expect(appServiceRegistry.has("bar")).toBe(false);
    });

    it("appIdOf 返回提供方应用 id", () => {
      appServiceRegistry.register("app1", {
        foo: () => makeService("foo", "app1"),
      });
      expect(appServiceRegistry.appIdOf("foo")).toBe("app1");
      expect(appServiceRegistry.appIdOf("nope")).toBeUndefined();
    });
  });

  describe("get（同步工厂）", () => {
    it("同步工厂立即返回且缓存（第二次不调工厂）", () => {
      const factory = vi.fn(() => makeService("foo", "app1"));
      appServiceRegistry.register("app1", { foo: factory });

      const s1 = appServiceRegistry.get<AppService>("foo");
      const s2 = appServiceRegistry.get<AppService>("foo");
      expect(s1).toBeDefined();
      expect(s2).toBe(s1); // 同一引用（缓存）
      expect(factory).toHaveBeenCalledTimes(1);
    });

    it("未注册返回 null", () => {
      expect(appServiceRegistry.get("nope")).toBeNull();
    });
  });

  describe("request（异步工厂）", () => {
    it("异步工厂 request 返回实例且缓存", async () => {
      const factory = vi.fn(async () => makeService("bar", "app2"));
      appServiceRegistry.register("app2", { bar: factory });

      const s1 = await appServiceRegistry.request<AppService>("bar");
      const s2 = await appServiceRegistry.request<AppService>("bar");
      expect(s1).toBeDefined();
      expect(s2).toBe(s1);
      expect(factory).toHaveBeenCalledTimes(1);
    });

    it("异步工厂 get 返回 null（同步无法返回）", () => {
      appServiceRegistry.register("app2", {
        bar: async () => makeService("bar", "app2"),
      });
      expect(appServiceRegistry.get("bar")).toBeNull();
    });

    it("未注册 request 抛 AppServiceNotInstalled", async () => {
      try {
        await appServiceRegistry.request("nope");
        expect.unreachable("应抛错");
      } catch (e) {
        expect(e).toBeInstanceOf(AppServiceNotInstalled);
        expect((e as AppServiceNotInstalled).serviceId).toBe("nope");
      }
    });
  });

  describe("unregisterApp", () => {
    it("清理该应用的声明与缓存", () => {
      appServiceRegistry.register("app1", {
        foo: () => makeService("foo", "app1"),
      });
      // 先构造缓存
      appServiceRegistry.get<AppService>("foo");
      expect(appServiceRegistry.has("foo")).toBe(true);

      appServiceRegistry.unregisterApp("app1");
      expect(appServiceRegistry.has("foo")).toBe(false);
      expect(appServiceRegistry.get("foo")).toBeNull();
    });

    it("不影响其它应用的 service", () => {
      appServiceRegistry.register("app1", {
        foo: () => makeService("foo", "app1"),
      });
      appServiceRegistry.register("app2", {
        bar: () => makeService("bar", "app2"),
      });
      appServiceRegistry.unregisterApp("app1");
      expect(appServiceRegistry.has("foo")).toBe(false);
      expect(appServiceRegistry.has("bar")).toBe(true);
    });
  });

  describe("register 覆盖", () => {
    it("重装场景覆盖旧声明", () => {
      appServiceRegistry.register("app1", {
        foo: () => makeService("foo", "app1"),
      });
      appServiceRegistry.register("app1", {
        foo: () => makeService("foo", "app1-v2"),
      });
      const s = appServiceRegistry.get<AppService & { id: string }>("foo");
      expect(s?.appId).toBe("app1-v2");
    });
  });
});
