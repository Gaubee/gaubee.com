/**
 * gaubeeos 总线单元测试。
 *
 * mock appManager + 直接用真实 appServiceRegistry，
 * 验证 getAppService/hasService/requestAppService 的委托逻辑。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// mock appManager（bus.ts 依赖）
const mockAppManager = {
  isInstalled: vi.fn(),
};
vi.mock("$lib/apps/AppManager.svelte", () => ({
  appManager: mockAppManager,
}));

// mock $app/environment（避免下游副作用）
vi.mock("$app/environment", () => ({ browser: false }));

// service 类型注册（bus.ts import type 各 service 接口；这里 mock 掉具体实现模块）
vi.mock("$lib/apps/builtin/account/service", () => ({}));
vi.mock("$lib/apps/installable/github/service", () => ({}));
vi.mock("$lib/apps/builtin/notifications/service.svelte", () => ({}));

const { gaubeeos, AppServiceNotInstalled } = await import("./bus");
const { appServiceRegistry } = await import("./registry");

describe("gaubeeos 总线", () => {
  beforeEach(() => {
    appServiceRegistry.clear();
    vi.clearAllMocks();
  });

  describe("getAppService", () => {
    it("已注册 service → 返回实例", () => {
      const svc = { id: "account", appId: "account" };
      appServiceRegistry.register("account", { account: () => svc });
      expect(gaubeeos.getAppService("account")).toBe(svc);
    });

    it("未注册 → 返回 null", () => {
      expect(gaubeeos.getAppService("account")).toBeNull();
    });
  });

  describe("hasService", () => {
    it("已注册 → true", () => {
      appServiceRegistry.register("account", {
        account: () => ({ id: "account", appId: "account" }),
      });
      expect(gaubeeos.hasService("account")).toBe(true);
    });

    it("未注册 → false", () => {
      expect(gaubeeos.hasService("git")).toBe(false);
    });
  });

  describe("requestAppService", () => {
    it("应用已安装 → 返回 service", async () => {
      const svc = { id: "git", appId: "github" };
      appServiceRegistry.register("github", { git: () => svc });
      mockAppManager.isInstalled.mockReturnValue(true);
      const result = await gaubeeos.requestAppService("git");
      expect(result).toBe(svc);
    });

    it("service 未声明 → 抛 AppServiceNotInstalled", async () => {
      await expect(
        gaubeeos.requestAppService("nope" as "account"),
      ).rejects.toThrow(AppServiceNotInstalled);
    });

    it("应用未安装 → 抛 AppServiceNotInstalled", async () => {
      appServiceRegistry.register("github", {
        git: () => ({ id: "git", appId: "github" }),
      });
      mockAppManager.isInstalled.mockReturnValue(false);
      await expect(gaubeeos.requestAppService("git")).rejects.toThrow(
        AppServiceNotInstalled,
      );
    });
  });
});
