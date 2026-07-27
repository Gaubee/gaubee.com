import { leafRoute } from "$lib/router";
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
    activities: [
      {
        pattern: "/app/terminal",
        entry: true,
        // bottom 区应用暂走 AreaOutlet 的 bottom 旧机制（loadedBottomSlots），
        // 不经 ActivityRouter，root 字段仅供类型一致性 + 未来统一渲染用。
        root: leafRoute("terminal", () => import("$lib/views/TerminalView.svelte")),
      },
    ],
    // bottom 区 + 不在桌面默认网格（DEFAULT_HIDDEN），通过 Dock / 全部应用打开。
    hiddenFromNav: true,
    vfsOwnership: [],
    description: "终端命令行",
    longDescription: "内置 shell，暴露 PATH 中所有应用的 CLI 命令。支持文件操作、Git 命令等。",
    version: "1.0.0",
    author: "Gaubee",
  },
};
