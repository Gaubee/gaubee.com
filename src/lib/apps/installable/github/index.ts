/**
 * Github 应用（默认安装，可卸载）。
 *
 * v3 形态（列表页 + 详情页导航架构）：
 * - UI：GithubView 作路由分发器，按 pathname 分发到列表页（RepoListView）/ 详情页（RepoDetailView）。
 *   列表页：聚合卡片（收藏 + 我的仓库 + org 仓库）+ 搜索。
 *   详情页：仓库元数据 + 5 Tab（文件+README / 历史 / 变更 / Issues / 日志）。
 * - 活动日志中心：记录各 App 的 git 操作（commit/sync/revert），供「日志」Tab 展示。
 * - isomorphic-git 能力降级为 CLI（git clone / git log），保留 GitStore.svelte.ts 不删。
 * - 通过 GitService 向其它应用提供仓库操作能力（读取/暂存/提交 + 活动日志 hook）。
 */
import GitHubMark from "$lib/components/icons/GitHubMark.svelte";

import type { AppEntry } from "../../types";
import { gitCommands } from "./commands";
import { githubHomeRoute } from "./routes";
import { gitService } from "./service";

export const githubApp: AppEntry = {
  manifest: {
    id: "github",
    name: "Github",
    icon: GitHubMark,
    category: "default",
    // v3：从 bottom 区提升为 main 区主屏应用（全屏列表/详情）。
    defaultArea: "main",
    activities: [
      {
        pattern: "/app/github",
        entry: true,
        root: githubHomeRoute,
      },
    ],
    vfsOwnership: [".git/"],
    // git 聚合命令（status/commit/pull/clone/log），实现走 GitService 或 GitStore。
    // 注意：git 是聚合命令，shell runLine 对 "git" 特判分发，不进 PathManager 扁平注册。
    cliCommands: gitCommands,
    // 向 GaubeeOS 暴露 git 服务（gaubeeos.getAppService('git')）
    services: {
      git: () => gitService,
    },
    description: "GitHub 仓库控制台",
    longDescription:
      "GitHub 仓库浏览控制台：列表页（收藏/我的仓库/org 仓库聚合卡片 + 搜索）+ 详情页（文件树 + README / 历史 / 变更 / Issues / 活动日志）+ GitService。isomorphic-git 克隆能力降级为 CLI（git clone / git log）。",
    version: "3.0.0",
    author: "Gaubee",
    homepage: "https://github.com/Gaubee/gaubee.com",
  },
};
