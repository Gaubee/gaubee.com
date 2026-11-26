import { leafRoute } from "$lib/router";
/**
 * 搜索应用（系统内置，不可卸载）。
 *
 * 独立 main 区应用：标签常驻保活，切走再切回不丢查询与结果；历史/缓存在视图层。
 */
import Search from "@lucide/svelte/icons/search";

import type { AppEntry } from "../types";

export const searchApp: AppEntry = {
  manifest: {
    id: "search",
    name: "搜索",
    icon: Search,
    category: "system",
    defaultArea: "main",
    activities: [
      {
        pattern: "/app/search",
        entry: true,
        root: leafRoute("search", () => import("$lib/views/SearchView.svelte")),
      },
    ],
    vfsOwnership: [],
    // tray 右上角快捷入口：切到搜索应用（已打开则命中同一 tab，状态保留）
    appMenus: [
      {
        id: "search:tray",
        title: "搜索",
        icon: Search,
        placement: "tray",
        order: 0,
        onClick: () =>
          import("$lib/nav/nav-controller-instance").then((m) =>
            m.navController.navigateMain("/app/search"),
          ),
      },
    ],
    description: "搜索所有内容",
    longDescription:
      "搜索文章与事件，支持自然语言与 Lucene 语法。搜索是独立应用：切走再切回会保留查询、结果和滚动位置，并记录最近搜索。",
  },
};
