/**
 * AccountService 单元测试。
 *
 * AccountService 委托 authStore，这里 mock authStore 验证委托与守卫逻辑。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// mock authStore（AccountService 的内部实现依赖）
const mockAuthStore: {
  state: {
    loaded: boolean;
    authenticated: boolean;
    user: {
      login: string;
      name: string | null;
      avatar_url: string;
      id: number;
    } | null;
    error: string | null;
  };
  isAuthenticated: boolean;
  login: ReturnType<typeof vi.fn>;
  logout: ReturnType<typeof vi.fn>;
  refresh: ReturnType<typeof vi.fn>;
} = {
  state: { loaded: true, authenticated: false, user: null, error: null },
  isAuthenticated: false,
  login: vi.fn(),
  logout: vi.fn(),
  refresh: vi.fn(),
};
vi.mock("$lib/auth/session.svelte", () => ({
  authStore: mockAuthStore,
}));

// mock $app/environment（避免 session.svelte 的 browser 副作用）
vi.mock("$app/environment", () => ({ browser: false }));

const { accountService, ACCOUNT_UNAVAILABLE } = await import("./service");
const { NotAuthenticatedError } = await import("$lib/os/services");

describe("AccountService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthStore.isAuthenticated = false;
    mockAuthStore.state.authenticated = false;
  });

  describe("requireAuthenticated", () => {
    it("未认证 → 抛 NotAuthenticatedError", () => {
      expect(() => accountService.requireAuthenticated()).toThrow(
        NotAuthenticatedError,
      );
    });

    it("已认证 → 不抛", () => {
      mockAuthStore.isAuthenticated = true;
      expect(() => accountService.requireAuthenticated()).not.toThrow();
    });
  });

  describe("委托 authStore", () => {
    it("login 调 authStore.login", () => {
      accountService.login();
      expect(mockAuthStore.login).toHaveBeenCalledTimes(1);
    });

    it("logout 调 authStore.logout", async () => {
      await accountService.logout();
      expect(mockAuthStore.logout).toHaveBeenCalledTimes(1);
    });

    it("refresh 调 authStore.refresh", async () => {
      await accountService.refresh();
      expect(mockAuthStore.refresh).toHaveBeenCalledTimes(1);
    });
  });

  describe("state 投影", () => {
    it("state 投影 authStore.state", () => {
      mockAuthStore.state = {
        loaded: true,
        authenticated: true,
        user: { login: "gaubee", name: "G", avatar_url: "u", id: 1 },
        error: null,
      };
      expect(accountService.state.authenticated).toBe(true);
      expect(accountService.state.user?.login).toBe("gaubee");
    });

    it("isAuthenticated 投影 authStore.isAuthenticated", () => {
      mockAuthStore.isAuthenticated = true;
      expect(accountService.isAuthenticated).toBe(true);
    });
  });

  describe("ACCOUNT_UNAVAILABLE 常量", () => {
    it("loaded 为 false（降级应显示骨架态）", () => {
      expect(ACCOUNT_UNAVAILABLE.loaded).toBe(false);
      expect(ACCOUNT_UNAVAILABLE.authenticated).toBe(false);
      expect(ACCOUNT_UNAVAILABLE.user).toBeNull();
    });
  });
});
