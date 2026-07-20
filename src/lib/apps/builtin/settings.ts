/**
 * 设置应用（系统内置，不可卸载）。
 *
 * 功能：系统设置、应用管理（安装/卸载应用）。
 */
import Settings from "@lucide/svelte/icons/settings";
import type { AppEntry } from "../types";

export const settingsApp: AppEntry = {
  manifest: {
    id: "settings",
    name: "设置",
    icon: Settings,
    category: "system",
    defaultArea: "main",
    route: "/app/settings",
    vfsOwnership: [],
  },
  view: () => import("$lib/views/SettingsView.svelte"),
};
