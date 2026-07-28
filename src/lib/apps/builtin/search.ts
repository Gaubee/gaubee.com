import { leafRoute } from "$lib/router";
/**
 * 搜索应用（系统内置，不可卸载）。
 *
 * 功能：全文搜索所有文章内容。pop 浮层应用。
 */
import Search from "@lucide/svelte/icons/search";

import type { AppEntry } from "../types";

export const searchApp: AppEntry = {
  manifest: {
    id: "search",
    name: "搜索",
    icon: Search,
    category: "system",
    defaultArea: "pop",
    activities: [
      {
        pattern: "/app/search",
        entry: true,
        // 注意：pop 浮层应用走 AreaOutlet 的 popLoader 路径（旧机制），
        // 不经 ActivityRouter，root 字段仅供类型一致性 + 未来统一渲染用。
        root: leafRoute("search", () => import("$lib/views/SearchView.svelte")),
      },
    ],
    // 浮层应用：不占 main/bottom tab，只通过 pop 入口进入
    hiddenFromNav: true,
    vfsOwnership: [],
    // tray 右上角快捷入口（点击打开搜索浮层）
    appMenus: [
      {
        id: "search:tray",
        title: "搜索",
        icon: Search,
        placement: "tray",
        order: 0,
        onClick: () =>
          import("$lib/nav/nav-controller-instance").then((m) =>
            m.navController.activatePop("/app/search"),
          ),
      },
    ],
    description: "全文搜索所有内容",
    longDescription: "搜索文章与说说，支持 Lucene 查询语法和按应用过滤。结果按发布时间优先显示。",
  },
};
