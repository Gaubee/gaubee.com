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
        route: "/app/search",
        entry: true,
        view: () => import("$lib/views/SearchView.svelte"),
      },
    ],
    // 浮层应用：不占 main/bottom tab，只通过 pop 入口进入
    hiddenFromNav: true,
    vfsOwnership: [],
  },
};
