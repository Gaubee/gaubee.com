/**
 * 通知应用（系统内置，不可卸载）。
 *
 * 职责：
 * 1. 提供 NotificationService（通知推送 + 历史记录），供其它应用获取。
 * 2. 提供通知中心界面（/app/notifications pop 浮层）。
 *
 * 通过 manifest.services 声明 notification service，由 AppManager 投影到
 * appServiceRegistry；其它应用经 gaubeeos.getAppService('notification') 获取，
 * 或用便捷函数 notifySuccess/notifyError/notifyInfo/notifyWarning。
 */
import Bell from "@lucide/svelte/icons/bell";
import type { AppEntry } from "../../types";
import { notificationService } from "./service.svelte";

export const notificationsApp: AppEntry = {
  manifest: {
    id: "notifications",
    name: "通知",
    icon: Bell,
    category: "system",
    defaultArea: "pop",
    activities: [
      {
        route: "/app/notifications",
        entry: true,
        view: () => import("$lib/apps/views/NotificationsView.svelte"),
      },
    ],
    // 浮层应用：不占 main/bottom tab，只通过 pop 入口进入
    hiddenFromNav: true,
    vfsOwnership: [],
    // 向 GaubeeOS 暴露 notification 服务
    services: {
      notification: () => notificationService,
    },
    // tray 右上角快捷入口（点击打开通知中心浮层）
    appMenus: [
      {
        id: "notifications:tray",
        title: "通知",
        icon: Bell,
        placement: "tray",
        order: 10,
        onClick: () =>
          import("$lib/nav/nav-controller-instance").then((m) =>
            m.navController.activatePop("/app/notifications"),
          ),
      },
    ],
  },
};
