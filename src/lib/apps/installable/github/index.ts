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
import { gitCommands } from "./commands";

export const githubApp: AppEntry = {
  manifest: {
    id: "github",
    name: "Github",
    icon: GitBranch,
    category: "default",
    defaultArea: "bottom",
    route: "/app/github",
    vfsOwnership: [".git/"],
    // git 聚合命令（status/commit/pull），实现走 GitService（鉴权 + 类型化错误）。
    // 注意：git 是聚合命令，shell runLine 对 "git" 特判分发，不进 PathManager 扁平注册。
    cliCommands: gitCommands,
    // 向 GaubeeOS 暴露 git 服务（gaubeeos.getAppService('git')）
    services: {
      git: () => gitService,
    },
  },
  view: () => import("$lib/apps/views/GithubView.svelte"),
};
