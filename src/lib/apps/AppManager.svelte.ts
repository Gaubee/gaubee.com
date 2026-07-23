/**
 * GaubeeOS 应用管理器（Svelte 5 runes）。
 *
 * 职责：
 * 1. 维护已安装应用列表（系统内置 + 用户安装）。
 * 2. 安装/卸载应用（持久化到 localStorage）。
 * 3. 提供 TabId 列表给 NavController。
 * 4. 提供应用元数据给 AreaNav / DesktopSidebar。
 * 5. 管理应用加载状态（视图组件按需加载）。
 */
import type { AppEntry, AppManifest, CliCommand, InstalledApp } from "./types";
import { getEntryRoute } from "./types";
import { pathManager } from "./PathManager";
import type { Command, CommandContext } from "../terminal/shell";
import { registerPathCommand, unregisterPathCommand } from "../terminal/shell";
import { searchServiceRegistry } from "$lib/search/registry";
import { appServiceRegistry } from "$lib/os/services";
import { settingsSectionsRegistry } from "./builtin/settings-sections";
import { widgetRegistry } from "./widget/registry";
import { appMenuRegistry } from "./menu/registry";
import { routeDomainRegistry } from "./route-domain";

// ---------------------------------------------------------------------------
// 工具：将 CliCommand 转换为 shell Command
// ---------------------------------------------------------------------------

function cliToShellCommand(cli: CliCommand): Command {
  return {
    name: cli.name,
    usage: cli.usage,
    description: cli.description,
    async run(ctx: CommandContext, args: string[]) {
      const result = await cli.run(ctx, args);
      // CliCommand 返回 { exit, newCwd }，但 shell Command.run 只返回 ExitCode
      // newCwd 由 shell 内部处理（cd 命令特判）
      return result.exit;
    },
  };
}

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

const STORAGE_KEY = "gaubee:os:apps";

/** 系统内置应用 ID（不可卸载）。desktop 是系统级桌面应用（默认首页）。 */
export const SYSTEM_APP_IDS = [
  "desktop",
  "articles",
  "shout",
  "search",
  "settings",
  "notifications",
  "account",
] as const;

/** 默认安装的应用 ID（可卸载）。 */
export const DEFAULT_APP_IDS = ["github", "terminal", "files", "writer"] as const;

export type SystemAppId = (typeof SYSTEM_APP_IDS)[number];
export type DefaultAppId = (typeof DEFAULT_APP_IDS)[number];

// ---------------------------------------------------------------------------
// 状态
// ---------------------------------------------------------------------------

class AppManager {
  /** 所有已注册的应用（静态 manifest）。 */
  private registry = new Map<string, AppEntry>();

  /** 已安装的应用 ID 列表。 */
  installedIds = $state<string[]>([]);

  /** 是否已初始化。 */
  initialized = $state(false);

  // ---- 派生视图 ----

  /** 所有已安装应用（含系统内置）。 */
  get allInstalled(): InstalledApp[] {
    return this.installedIds
      .map((id) => this.toInstalledApp(id))
      .filter(Boolean) as InstalledApp[];
  }

  /** main 区的应用（不含隐藏应用）。 */
  get mainApps(): InstalledApp[] {
    return this.allInstalled.filter(
      (app) => app.defaultArea === "main" && !app.hiddenFromNav,
    );
  }

  /** bottom 区的应用（不含隐藏应用）。 */
  get bottomApps(): InstalledApp[] {
    return this.allInstalled.filter(
      (app) => app.defaultArea === "bottom" && !app.hiddenFromNav,
    );
  }

  /** 所有已安装应用的 entry route（用于 NavController ALL_TABS，不含隐藏应用）。 */
  get allRoutes(): string[] {
    return this.allInstalled
      .filter((app) => !app.hiddenFromNav)
      .map((app) => getEntryRoute(app));
  }

  /** 可卸载的应用（非系统内置）。 */
  get uninstallable(): InstalledApp[] {
    return this.allInstalled.filter((app) => !app.builtin);
  }

  /** 可安装但未安装的应用。 */
  get available(): AppManifest[] {
    return Array.from(this.registry.values())
      .filter((entry) => entry.manifest.category !== "system")
      .filter((entry) => !this.installedIds.includes(entry.manifest.id))
      .map((entry) => entry.manifest);
  }

  /** 根据 entry route 查找应用。 */
  findByRoute(route: string): AppManifest | undefined {
    for (const entry of this.registry.values()) {
      if (getEntryRoute(entry.manifest) === route) return entry.manifest;
    }
    return undefined;
  }

  /** 根据 ID 查找应用。 */
  findById(id: string): AppManifest | undefined {
    return this.registry.get(id)?.manifest;
  }

  /** 根据 entry route 查找应用 ID。 */
  findIdByRoute(route: string): string | undefined {
    for (const [id, entry] of this.registry) {
      if (getEntryRoute(entry.manifest) === route) return id;
    }
    return undefined;
  }

  /** 检查 entry route 是否属于某个应用。 */
  isAppRoute(route: string): boolean {
    return this.allRoutes.includes(route);
  }

  // ---- 注册 ----

  /** 注册应用（模块加载时一次性调用）。
   *  同时投影路由域表（path → 应用归属，供聚焦激活判定）。 */
  register(entry: AppEntry): void {
    if (this.registry.has(entry.manifest.id)) {
      console.warn(`AppManager: 应用 ${entry.manifest.id} 已注册，忽略`);
      return;
    }
    this.registry.set(entry.manifest.id, entry);
    this.projectRouteDomain(entry.manifest);
  }

  /** 批量注册。 */
  registerAll(entries: AppEntry[]): void {
    for (const entry of entries) this.register(entry);
  }

  // ---- 初始化 ----

  /** 初始化：从 localStorage 恢复 + 安装默认应用。 */
  init(): void {
    if (this.initialized) return;

    // 系统应用始终安装
    const installed: string[] = [];
    for (const id of SYSTEM_APP_IDS) {
      if (this.registry.has(id)) installed.push(id);
    }

    // 从 localStorage 恢复用户安装
    const persisted = this.readStorage();
    if (persisted) {
      for (const id of persisted) {
        if (this.registry.has(id) && !installed.includes(id)) {
          installed.push(id);
        }
      }
    } else {
      // 首次访问：安装默认应用
      for (const id of DEFAULT_APP_IDS) {
        if (this.registry.has(id) && !installed.includes(id)) {
          installed.push(id);
        }
      }
    }

    this.installedIds = installed;
    this.syncSearchServices();
    this.syncServices();
    this.syncSettingsSections();
    this.syncWidgets();
    this.syncAppMenus();
    this.initialized = true;
  }

  // ---- 安装/卸载 ----

  /** 安装应用。 */
  install(id: string): boolean {
    const entry = this.registry.get(id);
    if (!entry) {
      console.warn(`AppManager: 应用 ${id} 未注册，无法安装`);
      return false;
    }
    if (entry.manifest.category === "system") {
      console.warn(`AppManager: 系统应用 ${id} 不可安装`);
      return false;
    }
    if (this.installedIds.includes(id)) return false;

    this.installedIds = [...this.installedIds, id];
    this.writeStorage();
    this.registerSearchService(entry);
    this.registerServices(entry);
    this.registerSettingsSections(entry.manifest);
    this.registerWidgets(entry.manifest);
    this.registerAppMenus(entry.manifest);

    // 注册 CLI 命令到 PATH
    if (entry.manifest.cliCommands) {
      for (const cli of entry.manifest.cliCommands) {
        pathManager.register(id, cli);
        // 同时注册到 shell 命令注册表
        registerPathCommand(cliToShellCommand(cli));
      }
    }

    return true;
  }

  /** 卸载应用。 */
  uninstall(id: string): boolean {
    if (this.isSystemApp(id)) {
      console.warn(`AppManager: 系统应用 ${id} 不可卸载`);
      return false;
    }
    const idx = this.installedIds.indexOf(id);
    if (idx === -1) return false;

    // 从 PATH 注销 CLI 命令
    const entry = this.registry.get(id);
    searchServiceRegistry.unregister(id);
    appServiceRegistry.unregisterApp(id);
    this.unregisterSettingsSections(id);
    this.unregisterWidgets(id);
    this.unregisterAppMenus(id);
    if (entry?.manifest.cliCommands) {
      for (const cli of entry.manifest.cliCommands) {
        pathManager.unregisterApp(id);
        unregisterPathCommand(cli.name);
      }
    }

    const next = [...this.installedIds];
    next.splice(idx, 1);
    this.installedIds = next;
    this.writeStorage();
    return true;
  }

  /** 检查是否系统应用。 */
  isSystemApp(id: string): boolean {
    return SYSTEM_APP_IDS.includes(id as SystemAppId);
  }

  /** 检查是否已安装。 */
  isInstalled(id: string): boolean {
    return this.installedIds.includes(id);
  }

  // ---- 持久化 ----

  private readStorage(): string[] | null {
    if (typeof localStorage === "undefined") return null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.every((i) => typeof i === "string")) {
        return parsed;
      }
    } catch {
      // ignore
    }
    return null;
  }

  private writeStorage(): void {
    if (typeof localStorage === "undefined") return;
    try {
      const toPersist = this.installedIds.filter((id) => !this.isSystemApp(id));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toPersist));
    } catch {
      // ignore
    }
  }

  /** 将已安装应用的搜索闭包投影到通用搜索注册表。 */
  private syncSearchServices(): void {
    for (const id of this.installedIds) {
      const entry = this.registry.get(id);
      if (entry) this.registerSearchService(entry);
    }
  }

  private registerSearchService(entry: AppEntry): void {
    const service = entry.manifest.searchService?.();
    if (service) searchServiceRegistry.register(service);
  }

  /** 将已安装应用声明的 services 投影到通用服务注册表。 */
  private syncServices(): void {
    for (const id of this.installedIds) {
      const entry = this.registry.get(id);
      if (entry) this.registerServices(entry);
    }
  }

  private registerServices(entry: AppEntry): void {
    if (entry.manifest.services) {
      appServiceRegistry.register(entry.manifest.id, entry.manifest.services);
    }
  }

  /** 将已安装应用的声明式 settings 面板投影到注册表。 */
  private syncSettingsSections(): void {
    for (const id of this.installedIds) {
      const entry = this.registry.get(id);
      if (entry) this.registerSettingsSections(entry.manifest);
    }
  }

  private registerSettingsSections(manifest: AppManifest): void {
    if (!manifest.settingsSections) return;
    for (const section of manifest.settingsSections) {
      settingsSectionsRegistry.register(section);
    }
  }

  private unregisterSettingsSections(appId: string): void {
    const manifest = this.findById(appId);
    if (!manifest?.settingsSections) return;
    for (const section of manifest.settingsSections) {
      settingsSectionsRegistry.unregister(section.id);
    }
  }

  /** 将已安装应用的声明式 widget 投影到 widget 注册表。 */
  private syncWidgets(): void {
    for (const id of this.installedIds) {
      const entry = this.registry.get(id);
      if (entry) this.registerWidgets(entry.manifest);
    }
  }

  private registerWidgets(manifest: AppManifest): void {
    if (!manifest.widgets) return;
    for (const widget of manifest.widgets) {
      widgetRegistry.register(widget);
    }
  }

  private unregisterWidgets(appId: string): void {
    const manifest = this.findById(appId);
    if (!manifest?.widgets) return;
    for (const widget of manifest.widgets) {
      widgetRegistry.unregister(widget.id);
    }
  }

  /** 将已安装应用的声明式状态栏菜单投影到菜单注册表。 */
  private syncAppMenus(): void {
    for (const id of this.installedIds) {
      const entry = this.registry.get(id);
      if (entry) this.registerAppMenus(entry.manifest);
    }
  }

  private registerAppMenus(manifest: AppManifest): void {
    if (!manifest.appMenus) return;
    for (const menu of manifest.appMenus) {
      appMenuRegistry.register(menu);
    }
  }

  private unregisterAppMenus(appId: string): void {
    const manifest = this.findById(appId);
    if (!manifest?.appMenus) return;
    for (const menu of manifest.appMenus) {
      appMenuRegistry.unregister(menu.id);
    }
  }

  // ---- 扩展点投影（路由域） ----

  /** 投影应用路由域：把每个 activity 的 route 注册到路由域表。 */
  private projectRouteDomain(manifest: AppManifest): void {
    routeDomainRegistry.registerApp(manifest);
  }

  // ---- 内部工具 ----

  private toInstalledApp(id: string): InstalledApp | null {
    const entry = this.registry.get(id);
    if (!entry) return null;
    return {
      ...entry.manifest,
      route: getEntryRoute(entry.manifest),
      installedAt: 0,
      builtin: this.isSystemApp(id),
      // 当前视图由 placeholders.ts 静态注册（非懒加载），无加载状态可追踪。
      // TODO: 切换到 activity.view 懒加载后，此处追踪加载状态。
      loaded: false,
    };
  }
}

/** 全局单例。 */
export const appManager = new AppManager();
