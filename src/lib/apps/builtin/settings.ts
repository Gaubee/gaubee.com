/**
 * 设置应用（系统内置，不可卸载）。
 *
 * 功能：系统设置、应用管理（安装/卸载应用）。
 *
 * 设置面板入口通过 settingsSectionsRegistry 动态注册（解耦）：
 * 本应用自身注册「关于」面板；其它应用（如账户）各自注册自己的入口。
 */
import Settings from "@lucide/svelte/icons/settings";
import Info from "@lucide/svelte/icons/info";
import type { Component } from "svelte";
import type { AppEntry } from "../types";
import { settingsSectionsRegistry } from "./settings-sections";
import AboutSection from "$lib/apps/views/AboutSection.svelte";

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

// 注册「关于」面板（设置应用自带的静态信息）。
// 谁提供能力谁注册入口；账户等其它面板由各自应用注册。
settingsSectionsRegistry.register({
  id: "about",
  title: "关于",
  description: "系统信息",
  icon: Info,
  order: 100,
  render: AboutSection as unknown as Component,
});
