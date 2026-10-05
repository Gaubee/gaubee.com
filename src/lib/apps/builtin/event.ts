import { searchIndexProcessor } from "$lib/content-pipeline/processors/search-index";
import { tagsProcessor } from "$lib/content-pipeline/processors/tags";
import { eventsSource } from "$lib/content-pipeline/sources/events";
import { leafRoute } from "$lib/router";
import { createFileSearchService } from "$lib/search/file-service";
/**
 * 事件应用（系统内置，不可卸载）。
 *
 * 功能：浏览事件列表（GitHub 日报 / X 日报 / X 历史归档 / 碎碎念）。
 * 数据来自内容管道（底层 readonlyVfs 构建时静态数据），无需登录即可阅读。
 *
 * 注意：事件详情走 /article/events/{stem}，由 articles 应用的 ArticleDetailView
 * 统一渲染（阅读器共享）。因此 event 只声明列表入口场景。
 *
 * 内容管道：声明 events 源；event 也参与标签和搜索（投影 tags/search-index 处理器，
 * 但 tags/search-index 已由 articles 注册且按 collection 去重，这里仅声明意图，
 * 实际执行时全量 entries 会被同一处理器消费）。
 */
import MessageSquare from "@lucide/svelte/icons/message-square";

import type { AppEntry } from "../types";
import RecentEventsWidget from "../widget/RecentEventsWidget.svelte";

export const eventApp: AppEntry = {
  manifest: {
    id: "event",
    name: "事件",
    icon: MessageSquare,
    category: "system",
    defaultArea: "main",
    activities: [
      {
        pattern: "/app/event",
        entry: true,
        root: leafRoute("event", () => import("$lib/apps/views/EventView.svelte")),
      },
    ],
    vfsOwnership: ["src/content/events/"],
    searchService: () => createFileSearchService({ appId: "event", appName: "事件" }),
    // ★ 声明式内容管道：events 源；处理器与 articles 共享（注册表按 id 去重）
    contentPipeline: {
      source: eventsSource,
      processors: [tagsProcessor, searchIndexProcessor],
    },
    // 桌面小组件：最近事件
    widgets: [
      {
        id: "recent-events",
        title: "最近事件",
        render: RecentEventsWidget,
        size: "medium",
        order: 1,
      },
    ],
    description: "浏览事件流",
    longDescription: "GitHub 日报、X 日报与历史归档按月浏览，数据来自只读静态层。点击进入详情阅读完整内容。",
  },
};
