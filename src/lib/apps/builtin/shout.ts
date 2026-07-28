import { searchIndexProcessor } from "$lib/content-pipeline/processors/search-index";
import { tagsProcessor } from "$lib/content-pipeline/processors/tags";
import { eventsSource } from "$lib/content-pipeline/sources/events";
import { leafRoute } from "$lib/router";
import { createFileSearchService } from "$lib/search/file-service";
/**
 * 说说应用（系统内置，不可卸载）。
 *
 * 功能：浏览短评/碎碎念列表。
 * 数据来自内容管道（底层 readonlyVfs 构建时静态数据），无需登录即可阅读。
 *
 * 注意：说说详情走 /article/events/{stem}，由 articles 应用的 ArticleDetailView
 * 统一渲染（阅读器共享）。因此 shout 只声明列表入口场景。
 *
 * 内容管道：声明 events 源；shout 也参与标签和搜索（投影 tags/search-index 处理器，
 * 但 tags/search-index 已由 articles 注册且按 collection 去重，这里仅声明意图，
 * 实际执行时全量 entries 会被同一处理器消费）。
 */
import MessageSquare from "@lucide/svelte/icons/message-square";

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
        pattern: "/app/shout",
        entry: true,
        root: leafRoute("shout", () => import("$lib/apps/views/ShoutView.svelte")),
      },
    ],
    vfsOwnership: ["src/content/events/"],
    searchService: () => createFileSearchService({ appId: "shout", appName: "说说" }),
    // ★ 声明式内容管道：events 源；处理器与 articles 共享（注册表按 id 去重）
    contentPipeline: {
      source: eventsSource,
      processors: [tagsProcessor, searchIndexProcessor],
    },
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
    description: "浏览短评与碎碎念",
    longDescription: "记录日常碎片想法，数据来自只读静态层。点击进入详情阅读完整内容。",
  },
};
