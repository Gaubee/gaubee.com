/**
 * 导航项元数据：给侧栏 AreaNav 渲染用。
 * 与 controller.ts 的 TabId 枚举一一对应，但这里带 UI 信息（icon/label/默认 area）。
 */
import Archive from "@lucide/svelte/icons/archive";
import FileText from "@lucide/svelte/icons/file-text";
import Files from "@lucide/svelte/icons/files";
import GitBranch from "@lucide/svelte/icons/git-branch";
import ListTodo from "@lucide/svelte/icons/list-todo";
import MonitorPlay from "@lucide/svelte/icons/monitor-play";
import Newspaper from "@lucide/svelte/icons/newspaper";
import Settings from "@lucide/svelte/icons/settings";
import type { Component } from "svelte";
import type { TabId } from "./controller";

export interface NavItem {
  /** 对应 TabId（侧栏 tab 的路由 id）。 */
  to: TabId;
  /** lucide 图标组件。 */
  icon: Component;
  /** 中文标签。 */
  label: string;
  /** 默认归属 area（用户可拖拽改变）。 */
  defaultArea: "main" | "bottom";
}

/** 所有 nav 项（顺序即默认侧栏顺序）。 */
export const allNavItems: NavItem[] = [
  // main
  { to: "/feed", icon: Newspaper, label: "阅读", defaultArea: "main" },
  { to: "/editor", icon: FileText, label: "编辑", defaultArea: "main" },
  { to: "/files", icon: Files, label: "文件", defaultArea: "main" },
  { to: "/changes", icon: ListTodo, label: "变更", defaultArea: "main" },
  { to: "/archive", icon: Archive, label: "归档", defaultArea: "main" },
  { to: "/settings", icon: Settings, label: "设置", defaultArea: "main" },
  // bottom
  { to: "/git", icon: GitBranch, label: "Git", defaultArea: "bottom" },
  {
    to: "/preview-server",
    icon: MonitorPlay,
    label: "预览",
    defaultArea: "bottom",
  },
];

/** TabId → NavItem 查表。 */
export const navItemMap: ReadonlyMap<TabId, NavItem> = new Map(
  allNavItems.map((item) => [item.to, item]),
);

export function getNavItem(tabId: TabId): NavItem | undefined {
  return navItemMap.get(tabId);
}
