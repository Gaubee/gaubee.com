import { defineRoute } from "$lib/router";
import Store from "@lucide/svelte/icons/store";
/**
 * 应用市场（系统内置，不可卸载）。
 *
 * 功能：应用管理（安装/卸载）。从设置页抽离，独立成应用。
 * 数据源：appManager.allInstalled（已安装）+ appManager.available（可安装）。
 *
 * 路由树（2026-07-28 路由系统重构迁移，替代 AppStoreView 的组件内正则分发）：
 *   /app/store（Activity root）
 *     ├─ ""        → AppStoreView（列表）
 *     └─ ":appId"  → AppStoreDetailView（详情）
 * appId 是单段标识符（如 writer/github），用嵌套子路由而非 search query。
 */
import { z } from "zod";

import type { AppEntry } from "../types";

/** app-store 应用入口路由（index=列表 + :appId=详情）。 */
export const appStoreRoute = defineRoute({
  id: "app-store",
  pattern: "",
  component: () => import("$lib/apps/views/AppStoreView.svelte"),
  children: [
    /** 应用详情页（appId 单段标识符）。 */
    defineRoute({
      id: "app-store.detail",
      pattern: ":appId",
      params: z.object({ appId: z.string().min(1) }),
      component: () => import("$lib/apps/views/AppStoreDetailView.svelte"),
    }),
  ],
});

export const appStoreApp: AppEntry = {
  manifest: {
    id: "app-store",
    name: "应用市场",
    icon: Store,
    category: "system",
    defaultArea: "main",
    activities: [
      {
        pattern: "/app/store",
        entry: true,
        root: appStoreRoute,
      },
    ],
    hiddenFromNav: true,
    description: "安装与管理应用",
    longDescription: "浏览、安装和卸载应用。系统应用不可卸载，可安装应用可随时移除。",
  },
};
