/**
 * GaubeeOS PATH/bin 管理器。
 *
 * 设计理念：
 * - 全局开放的 bin 目录，应用安装时将 CLI 命令注册到这里。
 * - Terminal 应用暴露 PATH 中的命令。
 * - 卸载应用时自动清理其注册的命令。
 */
import type { CliCommand } from "./types";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

interface CommandEntry {
  appId: string;
  command: CliCommand;
}

// ---------------------------------------------------------------------------
// PathManager
// ---------------------------------------------------------------------------

class PathManager {
  private commands = new Map<string, CommandEntry>();
  private aliases = new Map<string, string>(); // alias -> target command name

  /** 注册命令（应用安装时调用）。 */
  register(appId: string, command: CliCommand): void {
    if (this.commands.has(command.name)) {
      console.warn(`PathManager: 命令 '${command.name}' 已存在，由 ${appId} 覆盖`);
    }
    this.commands.set(command.name, { appId, command });
  }

  /** 批量注册命令。 */
  registerAll(appId: string, commands: CliCommand[]): void {
    for (const cmd of commands) this.register(appId, cmd);
  }

  /** 注销应用的所有命令（应用卸载时调用）。 */
  unregisterApp(appId: string): void {
    for (const [name, entry] of this.commands) {
      if (entry.appId === appId) {
        this.commands.delete(name);
      }
    }
    // 清理该应用的别名
    for (const [alias, target] of this.aliases) {
      const entry = this.commands.get(target);
      if (entry && entry.appId === appId) {
        this.aliases.delete(alias);
      }
    }
  }

  /** 获取命令。 */
  get(name: string): CliCommand | undefined {
    // 先查别名
    const aliased = this.aliases.get(name);
    if (aliased) return this.commands.get(aliased)?.command;
    return this.commands.get(name)?.command;
  }

  /** 检查命令是否存在。 */
  has(name: string): boolean {
    if (this.aliases.has(name)) return true;
    return this.commands.has(name);
  }

  /** 获取所有命令名（用于 Tab 补全）。 */
  getAllNames(): string[] {
    const names = new Set<string>();
    for (const name of this.commands.keys()) names.add(name);
    for (const alias of this.aliases.keys()) names.add(alias);
    return [...names].sort();
  }

  /** 添加别名。 */
  addAlias(alias: string, target: string): void {
    this.aliases.set(alias, target);
  }

  /** 获取命令所属的应用 ID。 */
  getAppId(name: string): string | undefined {
    return this.commands.get(name)?.appId;
  }
}

/** 全局单例。 */
export const pathManager = new PathManager();
