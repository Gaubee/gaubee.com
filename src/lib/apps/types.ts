/**
 * GaubeeOS 应用系统类型定义。
 *
 * 核心理念：Everything is an App。
 * 文章、说说、搜索、设置、通知、Github、Terminal、写作——所有功能都是"应用"，
 * 有统一的接口和生命周期。
 */
import type { Component } from "svelte";

// ---------------------------------------------------------------------------
// 应用分类
// ---------------------------------------------------------------------------

export type AppCategory = "system" | "default" | "installable";

/** 应用分类说明：
 * - system:     系统内置，不可卸载（文章、说说、搜索、设置、通知）
 * - default:    默认安装但可卸载（Github、Terminal）
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
// 应用声明
// ---------------------------------------------------------------------------

/** 应用元数据（不含视图组件，纯数据）。 */
export interface AppManifest {
  /** 唯一标识（如 'articles', 'github'）。 */
  id: string;
  /** 显示名称。 */
  name: string;
  /** Lucide 图标组件。 */
  icon: unknown /* Component */;
  /** 应用分类。 */
  category: AppCategory;
  /** 默认归属区域。 */
  defaultArea: "main" | "bottom";
  /** Tab 路由路径（如 '/app/articles'，用于 NavController）。 */
  route: string;
  /** 是否支持深链接（如 '/app/articles/article/xxx'）。 */
  supportsDeepLink?: boolean;
  /** CLI 命令列表（安装时注册到 PATH）。 */
  cliCommands?: CliCommand[];
  /** VFS 路径所有权（该应用"拥有"哪些路径）。 */
  vfsOwnership?: string[];
  /** 对其它应用的 VFS 路径权限请求。 */
  vfsPermissions?: { path: string; mode: "read" | "write" }[];
}

/** 已安装应用实例（含运行时状态）。 */
export interface InstalledApp extends AppManifest {
  /** 安装时间戳。 */
  installedAt: number;
  /** 是否为系统内置（不可卸载）。 */
  builtin: boolean;
  /** 是否已加载（视图组件已加载）。 */
  loaded: boolean;
}

// ---------------------------------------------------------------------------
// 视图加载器（懒加载）
// ---------------------------------------------------------------------------

/** 视图加载器：返回组件的工厂函数。 */
export type ViewLoader = () => Promise<{ default: Component }>;

/** 带视图加载器的应用注册项。 */
export interface AppEntry {
  manifest: AppManifest;
  view: ViewLoader;
}
