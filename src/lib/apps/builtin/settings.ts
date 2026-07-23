/**
 * 设置应用（系统内置，不可卸载）。
 *
 * 功能：系统设置、应用管理（安装/卸载应用）。
 * 设置面板入口通过 manifest.settingsSections 声明式注册（AppManager 投影）：
 * 本应用自身注册「关于」面板；其它应用（如账户）各自声明自己的面板。
 */
import Settings from "@lucide/svelte/icons/settings";
import Info from "@lucide/svelte/icons/info";
import PaletteIcon from "@lucide/svelte/icons/palette";
import MoonIcon from "@lucide/svelte/icons/moon";
import type { Component } from "svelte";
import { toggleMode } from "mode-watcher";
import AboutSection from "$lib/apps/views/AboutSection.svelte";
import AppearanceSection from "./appearance/AppearanceSection.svelte";
import type { AppEntry } from "../types";

export const settingsApp: AppEntry = {
  manifest: {
    id: "settings",
    name: "设置",
    icon: Settings,
    category: "system",
    defaultArea: "main",
    activities: [
      {
        route: "/app/settings",
        entry: true,
        view: () => import("$lib/views/SettingsView.svelte"),
      },
    ],
    vfsOwnership: [],
    settingsSections: [
      // 外观是 OS 级偏好，归属设置应用（无独立 activity）
      {
        id: "appearance",
        title: "外观",
        description: "切换明暗主题",
        icon: PaletteIcon,
        order: 1,
        render: AppearanceSection,
      },
      {
        id: "about",
        title: "关于",
        description: "系统信息",
        icon: Info,
        order: 100,
        render: AboutSection as unknown as Component,
      },
    ],
    // 系统菜单（苹果菜单，LOGO 触发）：设置入口、主题切换、关于
    appMenus: [
      {
        id: "settings:main",
        title: "系统",
        placement: "system",
        order: 0,
        items: [
          { id: "settings-entry", title: "设置…", icon: Settings, link: "/app/settings" },
          { id: "theme-toggle", title: "切换主题", icon: MoonIcon, onClick: toggleMode },
          { id: "sep1", title: "-", separator: true },
          { id: "about", title: "关于 GaubeeOS", icon: Info, link: "/app/settings" },
        ],
      },
    ],
  },
};
