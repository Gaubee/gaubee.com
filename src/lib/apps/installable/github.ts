/**
 * Github 应用（默认安装，可卸载）。
 *
 * 功能：Git 操作、仓库管理、文件变更提交。
 * 提供 CLI 命令：gh, git
 */
import GitBranch from "@lucide/svelte/icons/git-branch";
import type { AppEntry } from "../types";

export const githubApp: AppEntry = {
  manifest: {
    id: "github",
    name: "Github",
    icon: GitBranch,
    category: "default",
    defaultArea: "bottom",
    route: "/app/github",
    vfsOwnership: [".git/"],
    cliCommands: [
      // 在 path.ts 中注册
    ],
  },
  view: () => import("$lib/views/GitView.svelte"),
};
