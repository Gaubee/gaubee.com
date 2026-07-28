import { defineApp } from "$lib/app-scaffold/define-app";
import { searchIndexProcessor } from "$lib/content-pipeline/processors/search-index";
import { tagsProcessor } from "$lib/content-pipeline/processors/tags";
import { articlesSource } from "$lib/content-pipeline/sources/articles";
import { defineRoute, leafRoute } from "$lib/router";
import { createFileSearchService } from "$lib/search/file-service";
import ListIcon from "@lucide/svelte/icons/list";
/**
 * 文章应用（系统内置，不可卸载）。
 *
 * 功能：浏览文章列表、阅读文章详情、按标签浏览。
 * 数据来自内容管道（底层 readonlyVfs 构建时静态数据），无需登录即可阅读。
 *
 * 场景（activities）：
 * - /app/articles（entry）：文章列表。
 * - /article：文章详情（/article/{collection}/{stem}）。
 * - /tags：标签聚合（/tags/{tag}）。
 *
 * 内容管道：声明 articles 源 + tags/search-index 处理器（投影到 contentPipelineRegistry）。
 */
import Newspaper from "@lucide/svelte/icons/newspaper";
import TagsIcon from "@lucide/svelte/icons/tags";
import { z } from "zod";

import RecentArticlesWidget from "../widget/RecentArticlesWidget.svelte";
import TagsWidget from "../widget/TagsWidget.svelte";

/** 文章详情 Route：/article/{collection}/{stem}。
 *  带类型安全的 params schema，替代旧 ArticleDetailView 内部的 path.match 正则解析。 */
const articleDetailRoute = defineRoute({
  id: "articles.detail",
  pattern: ":collection/:stem",
  params: z.object({
    collection: z.enum(["articles", "events"]),
    stem: z.string().min(1),
  }),
  component: () => import("$lib/apps/views/ArticleDetailView.svelte"),
});

/** 标签 Route：/tags（标签云）+ /tags/{tag}（筛选）。
 *  root index 渲染标签云，child :tag 渲染带指定标签的文章列表。
 *  替代旧 TagsView 内部的 pathname 正则分发（2026-07-28 路由系统迁移）。 */
const tagsRoute = defineRoute({
  id: "articles.tags",
  pattern: "",
  component: () => import("$lib/views/TagsView.svelte"),
  children: [
    defineRoute({
      id: "articles.tags.detail",
      pattern: ":tag",
      params: z.object({ tag: z.string().min(1) }),
      component: () => import("$lib/views/TagsView.svelte"),
    }),
  ],
});

export const articlesApp = defineApp({
  id: "articles",
  name: "文章",
  icon: Newspaper,
  category: "system",
  defaultArea: "main",
  activities: [
    {
      pattern: "/app/articles",
      entry: true,
      root: leafRoute("articles", () => import("$lib/apps/views/ArticlesView.svelte")),
    },
    // 文章详情：/article/{collection}/{stem}。
    // 新方案：ActivityRouter 通过 useParams 把 collection/stem 注入 ArticleDetailView，
    // 替代旧的 pathname prop + 手工正则解析。
    {
      pattern: "/article",
      root: articleDetailRoute,
    },
    {
      pattern: "/tags",
      root: tagsRoute,
    },
  ],
  vfsOwnership: ["src/content/articles/"],
  searchService: () => createFileSearchService({ appId: "articles", appName: "文章" }),
  // ★ 声明式内容管道：articles 源 + 标签/搜索索引处理器
  contentPipeline: {
    source: articlesSource,
    processors: [tagsProcessor, searchIndexProcessor],
  },
  // 桌面小组件：最近文章 + 标签云（文章应用拥有这些内容）
  widgets: [
    {
      id: "recent-articles",
      title: "最近文章",
      render: RecentArticlesWidget,
      size: "medium",
      order: 0,
    },
    {
      id: "tags-cloud",
      title: "标签",
      render: TagsWidget,
      size: "medium",
      order: 2,
    },
  ],
  // 应用主菜单（当前文章应用激活时显示）：文章列表 + 按标签浏览
  appMenus: [
    {
      id: "articles:view",
      title: "显示",
      placement: "app",
      appId: "articles",
      order: 0,
      items: [
        { id: "article-list", title: "文章列表", icon: ListIcon, link: "/app/articles" },
        { id: "browse-tags", title: "按标签浏览", icon: TagsIcon, link: "/tags" },
      ],
    },
  ],
  description: "浏览文章列表，阅读文章详情",
  longDescription:
    "从构建时静态数据读取文章内容，无需登录即可阅读。支持按年份浏览、标签聚合和全文搜索。",
});
