import type { ContentProcessor, ContentSource } from "$lib/content-pipeline/types";
import type { ServiceDeclaration } from "$lib/os/services";
import type { RouteContract } from "$lib/router";
import type { SearchServiceFactory } from "$lib/search/types";
/**
 * GaubeeOS 应用系统类型定义。
 *
 * 心智模型：GaubeeOS = iPadOS。
 * - App（GaubeeApp）：一个完整应用身份（如「文章」「写作」）。
 * - Activity（AppActivity）：应用拥有的一个屏幕场景（Android Activity / iPadOS Scene），
 *   每个场景有一个绝对 pattern（如 '/app/github'）+ 一棵 RouteContract 树（root）。
 *   应用内的多页面通过 root 的 children 嵌套表达，类型安全（zod schema）。
 * - DeepLink（AppDeepLink）：应用对外拉起契约（搜索/通知/URL 可直达），公开/私有分离。
 * - Dock/任务栏（main/bottom tab）：OS 层启动器，一个应用一个图标，与场景形态正交。
 *   点击图标 = 聚焦应用 + 恢复最后场景（不重置到入口），同 iPadOS 点 Dock。
 * - area：屏幕分区（main=主区/Split View，bottom=Slide Over，pop=模态 Sheet）。
 *
 * 入口路由（entryRoute）派生自 entry activity 的 pattern：
 *   entryRoute = activities.find(a => a.entry)?.pattern ?? activities[0].pattern
 * 它同时是 Dock 图标身份（tabId）。
 *
 * 路由系统（2026-07-27 重构）：
 * - 旧字段 route/view 已删除，改为 pattern/root（root 是 RouteContract 树）。
 * - 旧 asView 已删除（被 RouteContract.component 取代）。
 * - 应用内多页面通过 defineRoute({ children }) 嵌套声明，zod schema 提供类型安全。
 * - 详见 $lib/router。
 */
import type { Component } from "svelte";

import type { SettingsSection } from "./builtin/settings-sections";
import type { AppMenuDeclaration } from "./menu/types";
import type { WidgetDeclaration } from "./widget/types";

// ---------------------------------------------------------------------------
// 应用分类
// ---------------------------------------------------------------------------

export type AppCategory = "system" | "default" | "installable";

/** 应用分类说明：
 * - system:     系统内置，不可卸载（文章、说说、搜索、设置、通知、账户）
 * - default:    默认安装但可卸载（Github、Terminal、工作流）
 * - installable: 可选安装（写作）
 */

// ---------------------------------------------------------------------------
// CLI 命令
// ---------------------------------------------------------------------------

/** 命令执行上下文（与 shell.ts 对齐）。 */
export interface CliCommandContext {
  /** 当前工作目录（VFS 相对路径）。 */
  cwd: string;
  /** 输出普通文本。 */
  write: (s: string) => void;
  /** 输出错误文本（红色 ANSI）。 */
  writeErr: (s: string) => void;
  /** 清屏。 */
  clear: () => void;
}

/** CLI 命令定义。 */
export interface CliCommand {
  name: string;
  description: string;
  usage: string;
  /** 执行命令。
   * @returns { newCwd: string | null } 如果命令改变了 cwd，返回新的 cwd */
  run: (ctx: CliCommandContext, args: string[]) => Promise<{ exit: number; newCwd: string | null }>;
}

// ---------------------------------------------------------------------------
// 视图加载器（懒加载）—— 过渡期保留，供旧 registry.ts/resolver.ts 使用
// ---------------------------------------------------------------------------

/**
 * 视图加载器：返回组件的工厂函数。
 *
 * @deprecated 2026-07-27 路由重构后，新应用应通过 RouteContract.component 表达视图懒加载。
 *             此类型仅供 views/registry.ts 等旧模块过渡期使用，阶段 5 清理时删除。
 */
export type ViewLoader = () => Promise<{ default: Component }>;

// ---------------------------------------------------------------------------
// 应用场景与深链接（iPadOS Activity / Scene / URL Scheme）
// ---------------------------------------------------------------------------

/** 应用的一个屏幕场景（Android Activity / iPadOS Scene）。
 * 每个场景有一个绝对 pattern + 一棵 RouteContract 树。 */
export interface AppActivity {
  /** 该场景的绝对 pattern（如 '/app/articles'、'/article'、'/app/editor'）。
   *  作为路由域前缀，ActivityRouter 在此基础上匹配 root 子树。 */
  pattern: string;
  /** 场景的根 Route 树（root.pattern 通常为 ''，代表「Activity 入口」）。
   *  应用内的多页面通过 root.children 嵌套表达。 */
  root: RouteContract;
  /** 是否为应用入口场景。
   * - true：Dock 图标身份（entryRoute）= 此 pattern；聚焦无记忆时落回此。
   * - 缺省：取 activities 中首个，或唯一标记 entry 的那个。
   * 每个 manifest 应恰好有一个 entry 场景。 */
  entry?: boolean;
  /**
   * 该场景是否从 Dock 任务栏隐藏（不占图标，通过深链接/菜单进入）。
   * 粒度跟随 Activity 而非 App——一个应用可有主场景进 Dock、辅助场景隐藏。
   * 缺省时继承 manifest.hiddenFromNav（作为该 app 所有 activity 的默认值）。
   */
  hiddenFromNav?: boolean;
}

/** 应用对外拉起契约（iPadOS URL Scheme / Android Intent）。
 * 描述「哪些外部路径可以拉起本应用的哪个场景」。
 * 与 activity 的区别：activity 是应用拥有并直接渲染的所有屏幕；
 * deepLink 是对外公开的拉起点（搜索结果/通知 action/外部 URL 直达）。 */
export interface AppDeepLink {
  /** 拉起路径前缀。 */
  pattern: string;
  /** 该 deepLink 实际拉起的场景 pattern（缺省=匹配同 pattern 的 activity）。 */
  activity?: string;
}

// ---------------------------------------------------------------------------
// 应用声明
// ---------------------------------------------------------------------------

/** 应用元数据（纯数据，不含运行时状态）。 */
export interface AppManifest {
  /** 唯一标识（如 'articles', 'github'）。 */
  id: string;
  /** 显示名称。 */
  name: string;
  /** Lucide 图标组件。 */
  icon: Component;
  /** 应用分类。 */
  category: AppCategory;
  /** 默认归属区域（main=主区 / bottom=Slide Over / pop=模态）。 */
  defaultArea: "main" | "bottom" | "pop";
  /** ★ 应用拥有的全部屏幕场景。入口路由（Dock 身份）派生自 entry activity。 */
  activities: AppActivity[];
  /** 对外拉起契约（搜索/通知/URL 可直达）。 */
  deepLinks?: AppDeepLink[];
  /**
   * 该应用所有 Activity 的 hiddenFromNav 默认值。
   * Activity 级别的 hiddenFromNav（AppActivity.hiddenFromNav）优先于此。
   * 用于只通过深链接或浮层进入的应用（如 account、search、notifications）。
   */
  hiddenFromNav?: boolean;
  /** CLI 命令列表（安装时注册到 PATH）。 */
  cliCommands?: CliCommand[];
  /** VFS 路径所有权（该应用"拥有"哪些路径）。 */
  vfsOwnership?: string[];
  /** 对其它应用的 VFS 路径权限请求。 */
  vfsPermissions?: { path: string; mode: "read" | "write" }[];
  /** 可选搜索适配闭包；搜索应用仅通过此协议发现能力。 */
  searchService?: SearchServiceFactory;
  /**
   * 该应用向 GaubeeOS 暴露的命名服务（service id → 工厂闭包）。
   * 其它应用通过 gaubeeos.getAppService / requestAppService 获取，
   * 由 AppManager 在安装/初始化时投影到 appServiceRegistry。
   */
  services?: ServiceDeclaration;
  /** ★ 声明式设置面板（AppManager 投影到 settingsSectionsRegistry，卸载联动）。 */
  settingsSections?: SettingsSection[];
  /** ★ 声明式桌面小组件（AppManager 投影到 widgetRegistry，DesktopView 渲染）。 */
  widgets?: WidgetDeclaration[];
  /** ★ 声明式状态栏菜单（AppManager 投影到 appMenuRegistry，SystemStatusBar 渲染）。
   *  三种位置：system（苹果菜单）/ app（当前应用菜单）/ tray（右上角快捷入口）。 */
  appMenus?: AppMenuDeclaration[];
  /** ★ 声明式内容管道（AppManager 投影到 contentPipelineRegistry，pipelineExecutor 执行）。
   *  source 声明该应用拥有的内容集合；processors 声明该应用贡献的派生产物（如标签/搜索索引）。 */
  contentPipeline?: {
    source?: ContentSource;
    processors?: ContentProcessor[];
  };

  // ---- 面向用户的展示元数据（应用市场详情页） ----

  /** 一句话简介（应用市场列表副文本）。 */
  description?: string;
  /** 详情页长描述（说明功能与适用场景）。 */
  longDescription?: string;
  /** 版本号（如 "1.0.0"）。 */
  version?: string;
  /** 作者或组织。 */
  author?: string;
  /** 项目主页 URL。 */
  homepage?: string;
}

/** 已安装应用实例（含运行时状态）。 */
export interface InstalledApp extends AppManifest {
  /** 派生：入口路由（Dock 图标身份）。= getEntryRoute(manifest)。
   *  在此显式声明，方便 shell 组件直接 app.route 读取，无需每次派生。 */
  route: string;
  /** 安装时间戳。 */
  installedAt: number;
  /** 是否为系统内置（不可卸载）。 */
  builtin: boolean;
  /** 是否已加载（视图组件已加载）。 */
  loaded: boolean;
}

/** 带视图加载器的应用注册项。 */
export interface AppEntry {
  manifest: AppManifest;
}

// ---------------------------------------------------------------------------
// 派生：入口路由（Dock 图标身份）
// ---------------------------------------------------------------------------

/** 从 manifest 的 activities 派生入口路由（= entry activity 的 pattern）。
 * 规则：取首个 entry:true 的 activity；若无标记则取 activities[0]。
 * 这是 Dock 图标身份（tabId），也是聚焦无记忆时的落点。 */
export function getEntryRoute(manifest: AppManifest): string {
  const entry = manifest.activities.find((a) => a.entry);
  return (entry ?? manifest.activities[0])?.pattern ?? "";
}
