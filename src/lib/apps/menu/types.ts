/**
 * 应用菜单（状态栏菜单）类型定义。
 *
 * 心智模型（macOS 状态栏）：
 * - system（苹果菜单）：LOGO 触发，聚合系统级入口（设置/主题/登录/退出）。通常由 SettingsApp/AccountApp 注册。
 * - app（应用主菜单）：当前激活应用名触发，含标准项（最小化/退出）+ 应用自注册菜单（如 File/Edit/View）。
 * - tray（右上角）：常驻快捷入口（搜索/通知），图标按钮触发。
 * - desktop（桌面菜单）：桌面态触发，仅桌面应用注册（如"管理桌面"）。
 *
 * 声明式扩展点：AppManifest.appMenus → AppManager 投影到 appMenuRegistry → SystemStatusBar 渲染。
 * 谁提供能力谁注册菜单，状态栏不反向依赖具体业务应用（与 settingsSections/widgets 同范式）。
 */
import type { Component } from "svelte";

/** 菜单位置。 */
export type MenuPlacement = "system" | "app" | "tray" | "desktop";

/** 菜单项（下拉项）。 */
export interface AppMenuItem {
  /** 唯一标识。 */
  id: string;
  /** 标题。 */
  title: string;
  /** Lucide 图标。 */
  icon?: Component;
  /** 深链接（点击 navigateMain）。与 onClick 二选一。 */
  link?: string;
  /** 命令式动作（如退出登录、切换主题、最小化）。 */
  onClick?: () => void;
  /** 分隔符（渲染为 Divider）。 */
  separator?: boolean;
  /** 禁用。 */
  disabled?: boolean;
}

/** 应用菜单声明（由 manifest.appMenus 注册）。 */
export interface AppMenuDeclaration {
  /** 全局唯一标识（建议 `${appId}:${name}`）。 */
  id: string;
  /** 顶层菜单标题（system 用 LOGO 替代标题；app 用应用名；tray 用图标）。 */
  title: string;
  /** Lucide 图标（tray/system 顶层触发器用）。 */
  icon?: Component;
  /** 渲染顺序，越小越靠前（同一 placement 内排序）。 */
  order?: number;
  /** 菜单位置。 */
  placement: MenuPlacement;
  /** 下拉项列表；空则纯按钮（点击触发 onClick）。 */
  items?: AppMenuItem[];
  /** 无 items 时的直接动作（tray 单图标按钮用，如 activatePop）。 */
  onClick?: () => void;
  /** placement:"app" 时，仅当该 appId 对应的应用激活时显示。 */
  appId?: string;
}
