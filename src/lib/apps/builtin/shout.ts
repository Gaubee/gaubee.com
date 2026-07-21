/**
 * 说说应用（系统内置，不可卸载）。
 *
 * 功能：浏览短评/碎碎念列表。
 * 数据来自 ReadonlyVFS（构建时静态数据），无需登录即可阅读。
 */
import MessageSquare from "@lucide/svelte/icons/message-square";
import { createFileSearchService } from "$lib/search/file-service";
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
    searchService: () =>
      createFileSearchService({ appId: "shout", appName: "说说" }),
  },
  view: () => import("$lib/apps/views/ShoutView.svelte"),
};
