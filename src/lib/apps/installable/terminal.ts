/**
 * Terminal 应用（默认安装，可卸载）。
 *
 * 功能：终端命令行，暴露 PATH 中所有应用的 CLI 命令。
 * 自身提供基础命令：clear, help
 */
import TerminalSquare from "@lucide/svelte/icons/terminal-square";
import type { AppEntry } from "../types";

export const terminalApp: AppEntry = {
  manifest: {
    id: "terminal",
    name: "Terminal",
    icon: TerminalSquare,
    category: "default",
    defaultArea: "bottom",
    route: "/app/terminal",
    vfsOwnership: [],
  },
  view: () => import("$lib/views/TerminalView.svelte"),
};
