/**
 * Github 应用（默认安装，可卸载）。
 *
 * 推倒重设计后的形态：
 * - UI：GitHub REST API 控制台（GithubView）：仓库选择器 + 历史/文件/变更/日志 4 Tab。
 *   历史/文件走 GitHub REST API（listCommits / listContents / getFileText），
 *   变更走 VFS（vfsStore dirty + GitService.commit），
 *   日志展示活动日志中心（activityLog）。
 * - 活动日志中心：记录各 App 的 git 操作（commit/sync/revert），供「日志」Tab 展示。
 * - isomorphic-git 能力降级为 CLI（git clone / git log），保留 GitStore.svelte.ts 不删。
 * - 通过 GitService 向其它应用提供仓库操作能力（读取/暂存/提交 + 活动日志 hook）。
 */
import GitHubMark from "$lib/components/icons/GitHubMark.svelte";

import type { AppEntry } from "../../types";
import { gitCommands } from "./commands";
import { gitService } from "./service";

export const githubApp: AppEntry = {
  manifest: {
    id: "github",
    name: "Github",
    icon: GitHubMark,
    category: "default",
    defaultArea: "bottom",
    activities: [
      {
        route: "/app/github",
        entry: true,
        view: () => import("$lib/apps/views/GithubView.svelte"),
      },
    ],
    // bottom 区 + 不在桌面默认网格（DEFAULT_HIDDEN），通过 Dock / 全部应用打开。
    hiddenFromNav: true,
    vfsOwnership: [".git/"],
    // git 聚合命令（status/commit/pull/clone/log），实现走 GitService 或 GitStore。
    // 注意：git 是聚合命令，shell runLine 对 "git" 特判分发，不进 PathManager 扁平注册。
    cliCommands: gitCommands,
    // 向 GaubeeOS 暴露 git 服务（gaubeeos.getAppService('git')）
    services: {
      git: () => gitService,
    },
    description: "GitHub REST 控制台",
    longDescription:
      "GitHub REST API 控制台（提交历史/文件树/变更/活动日志）+ GitService。isomorphic-git 克隆能力降级为 CLI（git clone / git log）。",
    version: "2.0.0",
    author: "Gaubee",
    homepage: "https://github.com/Gaubee/gaubee.com",
  },
};
