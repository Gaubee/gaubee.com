/**
 * 说说应用（系统内置，不可卸载）。
 *
 * 功能：浏览短评/碎碎念列表。
 * 数据来自 VFS 只读层（events 目录）。
 */
import MessageSquare from "@lucide/svelte/icons/message-square";
import type { AppEntry } from "../types";

export const shoutApp: AppEntry = {
  manifest: {
    id: "shout",
    name: "说说",
    icon: MessageSquare,
    category: "system",
    defaultArea: "main",
    route: "/app/shout",
    supportsDeepLink: true,
    vfsOwnership: ["src/content/events/"],
  },
  view: () => import("$lib/apps/views/ShoutView.svelte"),
};
