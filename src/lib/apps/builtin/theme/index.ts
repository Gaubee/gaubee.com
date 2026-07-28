import { leafRoute } from "$lib/router";
/**
 * 主题应用（系统内置，不可卸载）。
 *
 * 自定义 primary 色相 + 桌面背景。
 * - themeService 管理运行时色相（--primary-h），驱动 app.css 计算式派生。
 * - 桌面背景通过 desktopService（桌面应用提供）设置。
 *
 * 正交意图：
 * 1. 原始需求（2026-07-24）：引入主题应用，自定义 primary color（锁定亮度）+ 桌面背景。
 */
import PaletteIcon from "@lucide/svelte/icons/palette";

import type { AppEntry } from "../../types";
import { themeService } from "./service.svelte";

export const themeApp: AppEntry = {
  manifest: {
    id: "theme",
    name: "主题",
    icon: PaletteIcon,
    category: "system",
    defaultArea: "main",
    activities: [
      {
        pattern: "/app/theme",
        entry: true,
        root: leafRoute("theme", () => import("$lib/apps/views/ThemeView.svelte")),
      },
    ],
    // 向 GaubeeOS 暴露主题服务（gaubeeos.getAppService('theme')）
    services: {
      theme: () => themeService,
    },
    description: "自定义主题色与桌面背景",
    longDescription:
      "调整主题色相（亮度锁定，保证可访问性）和桌面背景（纯色/渐变/图片/动态 SVG 壁纸）。色相滑块实时预览，整个 OS 即时换色。",
  },
};
