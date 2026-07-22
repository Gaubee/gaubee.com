/**
 * 发表流程共享错误处理。
 *
 * EditorView（单篇发表）与 WriterView（批量发表）的 catch 块逻辑一致，
 * 抽到此 helper 消除重复。统一处理：
 * - NotAuthenticatedError → 引导到 /app/account 登录。
 * - AppServiceNotInstalled → 提示安装 Github 应用，跳 /app/settings。
 * - NoChangesError → 提示无待发表变更（信息级）。
 * - 其它 → 通用失败提示。
 *
 * 通知走 NotificationService（notify* 便捷函数），自动写入通知历史。
 * 返回 true 表示错误已处理（调用方通常无需再做事）。
 */
import {
  AppServiceNotInstalled,
  NotAuthenticatedError,
  NoChangesError,
} from "./bus";
import {
  notifyError,
  notifyInfo,
} from "$lib/apps/builtin/notifications/service.svelte";

/** 发表流程依赖的最小导航接口（避免硬耦合具体 NavController 类型）。 */
export interface PublishNavLike {
  navigateMain(path: string): void;
}

/**
 * 处理发表流程中抛出的错误。
 * @param e catch 到的错误
 * @param nav 导航控制器（需 navigateMain）
 * @returns true 表示已识别并处理
 */
export function handlePublishError(e: unknown, nav: PublishNavLike): boolean {
  if (e instanceof NotAuthenticatedError) {
    notifyError("请先登录账户", "即将跳转到账户页面");
    nav.navigateMain("/app/account");
    return true;
  }
  if (e instanceof AppServiceNotInstalled) {
    notifyError(
      "需要安装 Github 应用",
      "发表功能依赖 Github 应用提供仓库操作能力，请在设置中安装。",
    );
    nav.navigateMain("/app/settings");
    return true;
  }
  if (e instanceof NoChangesError) {
    notifyInfo("没有待发表的变更", "内容已是最新，无需重复发表");
    return true;
  }
  notifyError("发表失败", e instanceof Error ? e.message : String(e));
  return false;
}
