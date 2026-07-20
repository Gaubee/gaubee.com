/**
 * Github 应用（默认安装，可卸载）。
 *
 * 功能：基于 isomorphic-git 的完整 Git 能力。
 * 可以绑定任意仓库，支持 clone/log/diff/commit/push。
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
      // gh 命令在 path.ts 中注册
    ],
  },
  view: () => import("$lib/apps/views/GithubView.svelte"),
};
