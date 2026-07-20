/**
 * 文章应用（系统内置，不可卸载）。
 *
 * 功能：浏览文章列表、阅读文章详情。
 * 数据来自 ReadonlyVFS（构建时静态数据），无需登录即可阅读。
 */
import Newspaper from "@lucide/svelte/icons/newspaper";
import type { AppEntry } from "../types";

export const articlesApp: AppEntry = {
  manifest: {
    id: "articles",
    name: "文章",
    icon: Newspaper,
    category: "system",
    defaultArea: "main",
    route: "/app/articles",
    supportsDeepLink: true,
    vfsOwnership: ["src/content/articles/"],
  },
  view: () => import("$lib/apps/views/ArticlesView.svelte"),
};
