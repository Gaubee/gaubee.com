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
import {
  gaubeeos,
  AppServiceNotInstalled,
  NotAuthenticatedError,
  NoChangesError,
} from "$lib/os/services";

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
        ctx.write(
          `${ANSI.green}工作区干净，没有未提交的修改。${ANSI.reset}${newline}`,
        );
        return { exit: 0, newCwd: null };
      }
      ctx.write(
        `${ANSI.bold}未提交的修改（${dirty.length}）：${ANSI.reset}${newline}`,
      );
      for (const f of dirty.sort((a, b) => a.path.localeCompare(b.path))) {
        const tag =
          f.content === null
            ? `${ANSI.red}deleted ${ANSI.reset}`
            : `${ANSI.yellow}modified${ANSI.reset}`;
        ctx.write(`  ${tag}  ${f.path}${newline}`);
      }
      return { exit: 0, newCwd: null };
    } catch (e) {
      ctx.write(
        err(`git status: ${e instanceof Error ? e.message : "查询失败"}`) +
          newline,
      );
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
      ctx.write(
        `${ANSI.green}✓ 已提交${ANSI.reset} ${sha.slice(0, 7)}：${message}${newline}`,
      );
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
        ctx.write(
          err(`git commit: ${e instanceof Error ? e.message : "提交失败"}`) +
            newline,
        );
      }
      return { exit: 1, newCwd: null };
    }
  },
};

const gitPullCommand: CliCommand = {
  name: "git pull",
  usage: "git pull",
  description:
    "从 GitHub 同步 src/content 内容子树到 VFS（不覆盖本地未提交修改）。",
  async run(ctx) {
    try {
      const git = await getGit();
      ctx.write(`${ANSI.gray}正在同步内容…${ANSI.reset}${newline}`);
      await git.sync("src/content");
      ctx.write(`${ANSI.green}✓ 已同步${ANSI.reset}${newline}`);
      return { exit: 0, newCwd: null };
    } catch (e) {
      ctx.write(
        err(`git pull: ${e instanceof Error ? e.message : "同步失败"}`) +
          newline,
      );
      return { exit: 1, newCwd: null };
    }
  },
};

/** git 子命令实现（供 shell runLine 的 git 聚合分发器查找）。 */
export const gitCommands: CliCommand[] = [
  gitStatusCommand,
  gitCommitCommand,
  gitPullCommand,
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
]);
