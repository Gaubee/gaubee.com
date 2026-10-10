import { searchIndexProcessor } from "$lib/content-pipeline/processors/search-index";
import { tagsProcessor } from "$lib/content-pipeline/processors/tags";
import { eventsSource } from "$lib/content-pipeline/sources/events";
import { leafRoute } from "$lib/router";
import { createFileSearchService } from "$lib/search/file-service";
/**
 * 事件应用（系统内置，不可卸载）。
 *
 * 功能：三段布局工作区浏览事件（GitHub 日报 / X 日报 / X 历史归档 / 碎碎念）。
 * 数据来自内容管道（底层 readonlyVfs 构建时静态数据），无需登录即可阅读。
 *
 * URL 状态（2026-10-10 hash 化，kzf：ToC 锚点走片段）：
 * - ?month=YYYY-MM：当前月份（必显式；缺失/非法时视图规范化为最新月份并 REPLACE 回 URL）
 * - #<stem>：阅读流定位锚（ToC 语义——点标题滚动定位，滚动高亮跟随）；hashchange
 *   原生入历史栈，同路由导航不销毁列表 DOM。2026-10-10 前的 ?item= 深链由视图自动
 *   迁移到 hash 后 REPLACE 清除（schema 保留 item 字段仅为解析旧链接）。
 * 选 search 而非路径段：ActivityRouter 按 route id 保活组件，同 route 仅 search
 * 变化时列表 DOM/滚动位置不销毁（后退表现正确），与 ?file=/?sha= 的「单屏内
 * 视图状态走 query」惯例同族。
 *
 * 注意：/article/events/{stem} 旧深链保持不变，由 articles 应用的 ArticleDetailView
 * 独立渲染（SSG/搜索引用兼容）；其返回按钮会按条目月份回落到本工作区。
 *
 * 内容管道：声明 events 源；event 也参与标签和搜索（投影 tags/search-index 处理器，
 * 但 tags/search-index 已由 articles 注册且按 collection 去重，这里仅声明意图，
 * 实际执行时全量 entries 会被同一处理器消费）。
 */
import MessageSquare from "@lucide/svelte/icons/message-square";
import { z } from "zod";

import type { AppEntry } from "../types";
import RecentEventsWidget from "../widget/RecentEventsWidget.svelte";

/** 事件工作区 Route（唯一对象，两个 activity 共享——同 id 不同对象会触发注册表告警）。 */
const eventRoute = leafRoute(
  "event",
  () => import("$lib/apps/views/EventView.svelte"),
  z.object({
    month: z.string().min(1).optional(),
    item: z.string().min(1).optional(),
  }),
);

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
        root: eventRoute,
      },
      {
        // 旧书签兼容：说说时代的路径别名
        pattern: "/app/shout",
        root: eventRoute,
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
