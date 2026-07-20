/**
 * 通知应用（系统内置，不可卸载）。
 *
 * 功能：通知中心，显示历史通知。
 */
import Bell from "@lucide/svelte/icons/bell";
import type { AppEntry } from "../types";

export const notificationsApp: AppEntry = {
  manifest: {
    id: "notifications",
    name: "通知",
    icon: Bell,
    category: "system",
    defaultArea: "main",
    route: "/app/notifications",
    vfsOwnership: [],
  },
  view: () => import("$lib/apps/views/NotificationsView.svelte"),
};
