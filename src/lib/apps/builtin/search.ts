/**
 * 搜索应用（系统内置，不可卸载）。
 *
 * 功能：全文搜索所有文章内容。
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
    route: "/app/search",
    // 浮层应用：不占 main/bottom tab，只通过 pop 入口（侧栏浮层、移动端铃铛）进入
    hiddenFromNav: true,
    vfsOwnership: [],
  },
  view: () => import("$lib/views/SearchView.svelte"),
};
