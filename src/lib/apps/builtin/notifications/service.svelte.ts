/**
 * NotificationService：通知能力接口（GaubeeOS 应用服务总线的一部分）。
 *
 * 收口散落在各视图的 svelte-sonner toast 调用，统一提供：
 * - 即时 toast 显示（保持现有 svelte-sonner 行为）
 * - 持久化历史记录（localStorage），供 NotificationsView 渲染通知中心
 * - 未读计数（响应式，供铃铛角标）
 *
 * 消费方优先用导出的便捷函数 notifySuccess/notifyError/notifyInfo/notifyWarning，
 * 它们内部经 getAppService('notification') 获取 service；service 不可用时降级到直接 toast。
 */
import type { AppService } from "$lib/os/services";
import { gaubeeos } from "$lib/os/services";
import { browser } from "$app/environment";
import { toast } from "svelte-sonner";

/** 通知严重级别。 */
export type NotificationSeverity = "success" | "error" | "info" | "warning";

/** 通知的可选操作（点击通知卡片可跳转）。 */
export interface NotificationAction {
  /** 按钮文案，如「查看」「去登录」。 */
  label: string;
  /** 跳转路径（main 区），如 /app/changes、/app/account。 */
  href: string;
}

/** 一条通知记录。 */
export interface NotificationRecord {
  id: string;
  title: string;
  message?: string;
  severity: NotificationSeverity;
  read: boolean;
  timestamp: number;
  /** 可选操作：点击通知卡片跳转到此路径。 */
  action?: NotificationAction;
}

/** 通知服务接口。 */
export interface NotificationService extends AppService {
  readonly id: "notification";
  readonly appId: "notifications";
  /** 响应式历史记录（最新在前）。 */
  readonly history: NotificationRecord[];
  /** 未读数量（响应式派生）。 */
  readonly unreadCount: number;
  /** 推送通知：即时 toast + 写入历史。 */
  push(n: {
    title: string;
    message?: string;
    severity: NotificationSeverity;
    action?: NotificationAction;
  }): void;
  /** 标记全部已读。 */
  markAllRead(): void;
  /** 清空历史。 */
  clear(): void;
}

const STORAGE_KEY = "gaubee:os:notifications";
/** 历史上限，避免无限增长。 */
const MAX_HISTORY = 100;

/** 生成唯一 id。 */
function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * NotificationService 单例实现。
 *
 * - history 用 Svelte 5 $state，组件可响应式订阅。
 * - push 内部调 toast.* 即时显示，并写入 history + 持久化。
 */
class NotificationServiceImpl implements NotificationService {
  readonly id = "notification" as const;
  readonly appId = "notifications" as const;

  history = $state<NotificationRecord[]>([]);
  unreadCount = $derived(this.history.filter((n) => !n.read).length);

  constructor() {
    if (browser) {
      this.restore();
    }
  }

  push(n: {
    title: string;
    message?: string;
    severity: NotificationSeverity;
    action?: NotificationAction;
  }): void {
    const record: NotificationRecord = {
      id: genId(),
      title: n.title,
      message: n.message,
      severity: n.severity,
      read: false,
      timestamp: Date.now(),
      action: n.action,
    };
    // 即时 toast
    this.showToast(record);
    // 写入历史（最新在前）
    this.history = [record, ...this.history].slice(0, MAX_HISTORY);
    this.persist();
  }

  markAllRead(): void {
    this.history = this.history.map((n) => ({ ...n, read: true }));
    this.persist();
  }

  clear(): void {
    this.history = [];
    this.persist();
  }

  private showToast(record: NotificationRecord): void {
    switch (record.severity) {
      case "success":
        toast.success(
          record.title,
          record.message ? { description: record.message } : undefined,
        );
        break;
      case "error":
        toast.error(
          record.title,
          record.message ? { description: record.message } : undefined,
        );
        break;
      case "warning":
        toast.warning(
          record.title,
          record.message ? { description: record.message } : undefined,
        );
        break;
      case "info":
      default:
        toast.info(
          record.title,
          record.message ? { description: record.message } : undefined,
        );
        break;
    }
  }

  private persist(): void {
    if (!browser) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.history));
    } catch {
      // 存储满或不可用，忽略
    }
  }

  private restore(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        this.history = parsed.filter(
          (n): n is NotificationRecord =>
            n !== null &&
            typeof n === "object" &&
            typeof (n as NotificationRecord).id === "string" &&
            typeof (n as NotificationRecord).title === "string",
        );
      }
    } catch {
      // 损坏数据，忽略
    }
  }
}

/** 通知服务单例。 */
export const notificationService: NotificationService =
  new NotificationServiceImpl();

// ---------------------------------------------------------------------------
// 便捷函数：消费方优先用这些，自动经 service（不可用时降级到直接 toast）
// ---------------------------------------------------------------------------

/** 推送成功通知。action 可选：提供后通知卡片可点击跳转。 */
export function notifySuccess(
  title: string,
  message?: string,
  action?: NotificationAction,
): void {
  const svc = gaubeeos.getAppService("notification");
  if (svc) svc.push({ title, message, severity: "success", action });
  else toast.success(title, message ? { description: message } : undefined);
}

/** 推送错误通知。action 可选：提供后通知卡片可点击跳转。 */
export function notifyError(
  title: string,
  message?: string,
  action?: NotificationAction,
): void {
  const svc = gaubeeos.getAppService("notification");
  if (svc) svc.push({ title, message, severity: "error", action });
  else toast.error(title, message ? { description: message } : undefined);
}

/** 推送信息通知。action 可选：提供后通知卡片可点击跳转。 */
export function notifyInfo(
  title: string,
  message?: string,
  action?: NotificationAction,
): void {
  const svc = gaubeeos.getAppService("notification");
  if (svc) svc.push({ title, message, severity: "info", action });
  else toast.info(title, message ? { description: message } : undefined);
}

/** 推送警告通知。action 可选：提供后通知卡片可点击跳转。 */
export function notifyWarning(
  title: string,
  message?: string,
  action?: NotificationAction,
): void {
  const svc = gaubeeos.getAppService("notification");
  if (svc) svc.push({ title, message, severity: "warning", action });
  else toast.warning(title, message ? { description: message } : undefined);
}
