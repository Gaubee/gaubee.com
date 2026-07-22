/**
 * Github 应用（默认安装，可卸载）。
 *
 * 功能：
 * - 基于 isomorphic-git 的完整 Git 能力（clone/log/diff/commit/push），UI 见 GithubView。
 * - 通过 GitService 向其它应用提供仓库操作能力（读取/暂存/提交），
 *   供写作发表等流程使用。
 */
import GitBranch from "@lucide/svelte/icons/git-branch";
import type { AppEntry } from "../../types";
import { gitService } from "./service";

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
    // 向 GaubeeOS 暴露 git 服务（gaubeeos.getAppService('git')）
    services: {
      git: () => gitService,
    },
  },
  view: () => import("$lib/apps/views/GithubView.svelte"),
};
