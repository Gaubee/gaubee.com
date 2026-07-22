/**
 * publish-helper 单元测试。
 *
 * 验证 handlePublishError 的四个错误分支（instanceof 契约）：
 * NotAuthenticatedError / AppServiceNotInstalled / NoChangesError / 其它。
 */
import { describe, expect, it, vi } from "vitest";

// mock notification 便捷函数（publish-helper 内部调用）
const mockNotifyError = vi.fn();
const mockNotifyInfo = vi.fn();
vi.mock("$lib/apps/builtin/notifications/service.svelte", () => ({
  notifyError: (t: string, m?: string) => mockNotifyError(t, m),
  notifyInfo: (t: string, m?: string) => mockNotifyInfo(t, m),
}));

const { handlePublishError } = await import("./publish-helper");
const { NotAuthenticatedError, AppServiceNotInstalled, NoChangesError } =
  await import("./bus");

/** 构造 fake nav。 */
function makeNav() {
  return { navigateMain: vi.fn() };
}

describe("handlePublishError", () => {
  it("NotAuthenticatedError → 跳 /app/account + notifyError", () => {
    const nav = makeNav();
    const result = handlePublishError(new NotAuthenticatedError(), nav);
    expect(result).toBe(true);
    expect(nav.navigateMain).toHaveBeenCalledWith("/app/account");
    expect(mockNotifyError).toHaveBeenCalledWith(
      "请先登录账户",
      "即将跳转到账户页面",
    );
  });

  it("AppServiceNotInstalled → 跳 /app/settings + notifyError", () => {
    const nav = makeNav();
    const result = handlePublishError(new AppServiceNotInstalled("git"), nav);
    expect(result).toBe(true);
    expect(nav.navigateMain).toHaveBeenCalledWith("/app/settings");
    expect(mockNotifyError).toHaveBeenCalled();
  });

  it("NoChangesError → notifyInfo", () => {
    const nav = makeNav();
    const result = handlePublishError(new NoChangesError(), nav);
    expect(result).toBe(true);
    expect(nav.navigateMain).not.toHaveBeenCalled();
    expect(mockNotifyInfo).toHaveBeenCalledWith(
      "没有待发表的变更",
      "内容已是最新，无需重复发表",
    );
  });

  it("普通 Error → notifyError（通用失败）", () => {
    const nav = makeNav();
    const result = handlePublishError(new Error("网络错误"), nav);
    expect(result).toBe(false);
    expect(nav.navigateMain).not.toHaveBeenCalled();
    expect(mockNotifyError).toHaveBeenCalledWith("发表失败", "网络错误");
  });

  it("非 Error 值 → notifyError（String 兜底）", () => {
    const nav = makeNav();
    handlePublishError("怪异值", nav);
    expect(mockNotifyError).toHaveBeenCalledWith("发表失败", "怪异值");
  });
});
