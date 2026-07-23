/**
 * 文章应用（系统内置，不可卸载）。
 *
 * 功能：浏览文章列表、阅读文章详情、按标签浏览。
 * 数据来自 ReadonlyVFS（构建时静态数据），无需登录即可阅读。
 *
 * 场景（activities）：
 * - /app/articles（entry）：文章列表。
 * - /article：文章详情（/article/{collection}/{stem}）。
 * - /tags：标签聚合（/tags/{tag}）。
 */
import Newspaper from "@lucide/svelte/icons/newspaper";
import TagsIcon from "@lucide/svelte/icons/tags";
import ListIcon from "@lucide/svelte/icons/list";
import { createFileSearchService } from "$lib/search/file-service";
import { asView } from "../types";
import { defineApp } from "$lib/app-scaffold/define-app";
import RecentArticlesWidget from "../widget/RecentArticlesWidget.svelte";
import TagsWidget from "../widget/TagsWidget.svelte";

export const articlesApp = defineApp({
  id: "articles",
  name: "文章",
  icon: Newspaper,
  category: "system",
  defaultArea: "main",
  activities: [
    {
      route: "/app/articles",
      entry: true,
      view: () => import("$lib/apps/views/ArticlesView.svelte"),
    },
    // 文章详情需 pathname prop（由 AreaOutlet 从 location.pathname 注入），用 asView 断言。
    {
      route: "/article",
      view: asView(() => import("$lib/apps/views/ArticleDetailView.svelte")),
    },
    {
      route: "/tags",
      view: () => import("$lib/views/TagsView.svelte"),
    },
  ],
  vfsOwnership: ["src/content/articles/"],
  searchService: () =>
    createFileSearchService({ appId: "articles", appName: "文章" }),
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
});
