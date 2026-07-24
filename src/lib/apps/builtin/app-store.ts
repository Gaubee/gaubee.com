/**
 * 应用市场（系统内置，不可卸载）。
 *
 * 功能：应用管理（安装/卸载）。从设置页抽离，独立成应用。
 * 数据源：appManager.allInstalled（已安装）+ appManager.available（可安装）。
 */
import Store from "@lucide/svelte/icons/store";
import type { AppEntry } from "../types";

export const appStoreApp: AppEntry = {
  manifest: {
    id: "app-store",
    name: "应用市场",
    icon: Store,
    category: "system",
    defaultArea: "main",
    activities: [
      {
        route: "/app/store",
        entry: true,
        view: () => import("$lib/apps/views/AppStoreView.svelte"),
      },
    ],
    hiddenFromNav: true,
    description: "安装与管理应用",
    longDescription:
      "浏览、安装和卸载应用。系统应用不可卸载，可安装应用可随时移除。",
  },
};
