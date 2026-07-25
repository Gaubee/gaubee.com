import {
  gaubeeos,
  AppServiceNotInstalled,
  NotAuthenticatedError,
  NoChangesError,
} from "$lib/os/services";

/**
 * Github 应用的 CLI 命令（git 聚合命令的子命令）。
 *
 * 归属 github 应用，通过 manifest.cliCommands 声明。命令实现内部走 GitService
 * （gaubeeos.getAppService('git')），获得统一的鉴权守卫与类型化错误，
 * 不再绕过 service 直接操作 VFS。
 *
 * 注意：git 是聚合命令（git status / git commit / git pull），不适合 PathManager
 * 的扁平 name→command 注册。shell 的 runLine 对 "git" 做聚合分发，从本模块
 * 导出的 gitSubcommandMap 查找子命令实现。
 */
import type { CliCommand } from "../../types";

// 终端输出格式化（自包含，避免从 shell.ts 导入造成循环依赖）。
// 与 shell.ts 的 ANSI/Term 保持一致的转义码。
const ANSI = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  gray: "\x1b[90m",
  bold: "\x1b[1m",
} as const;
const newline = "\r\n";
const err = (s: string) => `${ANSI.red}${s}${ANSI.reset}`;

/** 获取 git service；未安装抛错（调用方在 shell 分发器层已保证 github 已安装）。 */
async function getGit() {
  return gaubeeos.requestAppService("git");
}

const gitStatusCommand: CliCommand = {
  name: "git status",
  usage: "git status",
  description: "显示未提交的修改列表。",
  async run(ctx) {
    try {
      const git = await getGit();
      const dirty = await git.dirtyFiles();
      if (dirty.length === 0) {
        ctx.write(`${ANSI.green}工作区干净，没有未提交的修改。${ANSI.reset}${newline}`);
        return { exit: 0, newCwd: null };
      }
      ctx.write(`${ANSI.bold}未提交的修改（${dirty.length}）：${ANSI.reset}${newline}`);
      for (const f of dirty.sort((a, b) => a.path.localeCompare(b.path))) {
        const tag =
          f.content === null
            ? `${ANSI.red}deleted ${ANSI.reset}`
            : `${ANSI.yellow}modified${ANSI.reset}`;
        ctx.write(`  ${tag}  ${f.path}${newline}`);
      }
      return { exit: 0, newCwd: null };
    } catch (e) {
      ctx.write(err(`git status: ${e instanceof Error ? e.message : "查询失败"}`) + newline);
      return { exit: 1, newCwd: null };
    }
  },
};

const gitCommitCommand: CliCommand = {
  name: "git commit",
  usage: "git commit <-m message>",
  description: "提交所有未提交修改到 GitHub（经 GitService，需登录）。",
  async run(ctx, args) {
    // 解析 -m "message" 或 -m message
    let message: string | null = null;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "-m") {
        message = args[i + 1] ?? null;
        i++;
      }
    }
    if (!message) {
      ctx.write(err("git commit: 缺少 -m <message>") + newline);
      return { exit: 1, newCwd: null };
    }
    try {
      const git = await getGit();
      ctx.write(`${ANSI.gray}正在提交…${ANSI.reset}${newline}`);
      const sha = await git.commit(message);
      ctx.write(`${ANSI.green}✓ 已提交${ANSI.reset} ${sha.slice(0, 7)}：${message}${newline}`);
      return { exit: 0, newCwd: null };
    } catch (e) {
      // GitService.commit 的鉴权与类型化错误在此统一处理
      if (e instanceof NotAuthenticatedError) {
        ctx.write(err("git commit: 需要先登录账户（/app/account）") + newline);
      } else if (e instanceof NoChangesError) {
        ctx.write(err("git commit: 没有待提交的变更") + newline);
      } else if (e instanceof AppServiceNotInstalled) {
        ctx.write(err("git commit: Github 应用未安装，无法提交") + newline);
      } else {
        ctx.write(err(`git commit: ${e instanceof Error ? e.message : "提交失败"}`) + newline);
      }
      return { exit: 1, newCwd: null };
    }
  },
};

const gitPullCommand: CliCommand = {
  name: "git pull",
  usage: "git pull",
  description: "从 GitHub 同步 src/content 内容子树到 VFS（不覆盖本地未提交修改）。",
  async run(ctx) {
    try {
      const git = await getGit();
      ctx.write(`${ANSI.gray}正在同步内容…${ANSI.reset}${newline}`);
      await git.sync("src/content");
      ctx.write(`${ANSI.green}✓ 已同步${ANSI.reset}${newline}`);
      return { exit: 0, newCwd: null };
    } catch (e) {
      ctx.write(err(`git pull: ${e instanceof Error ? e.message : "同步失败"}`) + newline);
      return { exit: 1, newCwd: null };
    }
  },
};

/**
 * git clone：基于 isomorphic-git 克隆仓库到 ZenFS（降级路径）。
 *
 * 用法：git clone <owner>/<repo> [branch]
 *
 * 注意：isomorphic-git 走公共 CORS proxy（https://cors.isomorphic-git.org），
 * 大仓库可能受 proxy 限速或失败。日常浏览请用 GithubApp 的 UI（REST API 控制台），
 * clone 仅用于需要本地完整 git 历史的离线场景。
 */
const gitCloneCommand: CliCommand = {
  name: "git clone",
  usage: "git clone <owner>/<repo> [branch]",
  description: "克隆仓库到浏览器（isomorphic-git，需 CORS proxy，大仓库可能失败）。",
  async run(ctx, args) {
    // args 形如 [git, clone, owner/repo, branch?]
    const target = args[2];
    if (!target || !target.includes("/")) {
      ctx.write(err("git clone: 用法 git clone <owner>/<repo> [branch]") + newline);
      return { exit: 1, newCwd: null };
    }
    const [owner, repo] = target.split("/");
    const branch = args[3]?.trim() || "main";
    if (!owner || !repo) {
      ctx.write(err("git clone: owner/repo 格式错误") + newline);
      return { exit: 1, newCwd: null };
    }
    try {
      // 懒加载 gitStore（isomorphic-git），避免 App UI 层硬依赖。
      const { gitStore } = await import("$lib/apps/GitStore.svelte");
      await gitStore.init();
      ctx.write(
        `${ANSI.gray}正在克隆 ${owner}/${repo}@${branch}（经 CORS proxy）…${ANSI.reset}${newline}`,
      );
      await gitStore.clone({ owner, repo, branch, shallow: true });
      const dir = `/repos/${owner}/${repo}`;
      ctx.write(
        `${ANSI.green}✓ 已克隆${ANSI.reset} ${owner}/${repo} → ${ANSI.bold}${dir}${ANSI.reset}${newline}`,
      );
      return { exit: 0, newCwd: null };
    } catch (e) {
      ctx.write(err(`git clone: ${e instanceof Error ? e.message : "克隆失败"}`) + newline);
      return { exit: 1, newCwd: null };
    }
  },
};

/**
 * git log：显示 isomorphic-git 克隆仓库的提交历史（降级路径）。
 *
 * 用法：git log [owner/repo]
 * 不带参数 → 当前激活的克隆仓库；带 owner/repo → 切换后再读历史。
 *
 * 注意：仅对已 `git clone` 的仓库有效。日常浏览主仓库历史用 GithubApp UI 的「历史」Tab。
 */
const gitLogCommand: CliCommand = {
  name: "git log",
  usage: "git log [owner/repo]",
  description: "显示已克隆仓库的提交历史（isomorphic-git，需先 git clone）。",
  async run(ctx, args) {
    try {
      const { gitStore } = await import("$lib/apps/GitStore.svelte");
      await gitStore.init();
      const target = args[2]?.trim();
      if (target) {
        if (!target.includes("/")) {
          ctx.write(err("git log: owner/repo 格式错误") + newline);
          return { exit: 1, newCwd: null };
        }
        await gitStore.switchRepo(target);
      }
      await gitStore.refresh();
      const commits = gitStore.commits;
      const repo = gitStore.activeRepo;
      if (!repo) {
        ctx.write(err("git log: 没有已克隆的仓库。先用 git clone <owner>/<repo> 克隆。") + newline);
        return { exit: 1, newCwd: null };
      }
      if (commits.length === 0) {
        ctx.write(`${ANSI.gray}（${repo.owner}/${repo.repo} 暂无提交历史）${ANSI.reset}${newline}`);
        return { exit: 0, newCwd: null };
      }
      ctx.write(
        `${ANSI.bold}${repo.owner}/${repo.repo}@${repo.branch}${ANSI.reset} ${ANSI.gray}(${commits.length})${ANSI.reset}${newline}`,
      );
      for (const c of commits) {
        const date = new Date(c.author.timestamp * 1000).toLocaleDateString("zh-CN");
        ctx.write(
          `${ANSI.yellow}${c.oid.slice(0, 7)}${ANSI.reset} ${date} ${ANSI.bold}${c.author.name}${ANSI.reset}${newline}` +
            `        ${c.message.split("\n")[0]}${newline}`,
        );
      }
      return { exit: 0, newCwd: null };
    } catch (e) {
      ctx.write(err(`git log: ${e instanceof Error ? e.message : "查询失败"}`) + newline);
      return { exit: 1, newCwd: null };
    }
  },
};

/** git 子命令实现（供 shell runLine 的 git 聚合分发器查找）。 */
export const gitCommands: CliCommand[] = [
  gitStatusCommand,
  gitCommitCommand,
  gitPullCommand,
  gitCloneCommand,
  gitLogCommand,
];

/**
 * git 子命令分发表（子命令名 → CliCommand）。
 * shell runLine 的 "git" 分支用此表分发；sync 作为 pull 的别名。
 */
export const gitSubcommandMap: Map<string, CliCommand> = new Map([
  ["status", gitStatusCommand],
  ["commit", gitCommitCommand],
  ["pull", gitPullCommand],
  ["sync", gitPullCommand], // sync 作为 pull 的别名
  ["clone", gitCloneCommand],
  ["log", gitLogCommand],
]);
