import { leafRoute } from "$lib/router";
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
        pattern: "/app/notifications",
        entry: true,
        // 注意：pop 浮层应用走 AreaOutlet 的 popLoader 路径（旧机制），
        // 不经 ActivityRouter，root 字段仅供类型一致性 + 未来统一渲染用。
        root: leafRoute("notifications", () => import("$lib/apps/views/NotificationsView.svelte")),
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
    description: "通知中心",
    longDescription:
      "聚合系统通知，提供即时 toast 推送和历史记录。其它应用通过 NotificationService 推送通知。",
  },
};
