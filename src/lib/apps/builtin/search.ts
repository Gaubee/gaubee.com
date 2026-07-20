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
    defaultArea: "main",
    route: "/app/search",
    vfsOwnership: [],
  },
  view: () => import("$lib/views/SearchView.svelte"),
};
