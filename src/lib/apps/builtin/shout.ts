/**
 * 说说应用（系统内置，不可卸载）。
 *
 * 功能：浏览短评/碎碎念列表。
 * 数据来自 ReadonlyVFS（构建时静态数据），无需登录即可阅读。
 *
 * 注意：说说详情走 /article/events/{stem}，由 articles 应用的 ArticleDetailView
 * 统一渲染（阅读器共享）。因此 shout 只声明列表入口场景。
 */
import MessageSquare from "@lucide/svelte/icons/message-square";
import { createFileSearchService } from "$lib/search/file-service";
import type { AppEntry } from "../types";
import RecentShoutsWidget from "../widget/RecentShoutsWidget.svelte";

export const shoutApp: AppEntry = {
  manifest: {
    id: "shout",
    name: "说说",
    icon: MessageSquare,
    category: "system",
    defaultArea: "main",
    activities: [
      {
        route: "/app/shout",
        entry: true,
        view: () => import("$lib/apps/views/ShoutView.svelte"),
      },
    ],
    vfsOwnership: ["src/content/events/"],
    searchService: () =>
      createFileSearchService({ appId: "shout", appName: "说说" }),
    // 桌面小组件：最近说说
    widgets: [
      {
        id: "recent-shouts",
        title: "最近说说",
        render: RecentShoutsWidget,
        size: "medium",
        order: 1,
      },
    ],
  },
};
