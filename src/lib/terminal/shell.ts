/**
 * 纯前端 bash 命令内核（基于 VFS，无后端执行）。
 *
 * 设计：
 * - 纯逻辑，框架无关，可被 vitest 直接测试（不依赖 Svelte/浏览器）。
 * - 命令通过 `vfs` 单例（src/lib/vfs/vfs.ts）操作文件，所有 API 异步。
 * - 路径：VFS 用仓库根相对路径（如 `src/content/articles/xxx.md`）。
 *   shell 的 cwd 是会话内"当前目录"概念，默认 `src/content`（让用户 ls 直接看到
 *   articles/events）。`resolvePath` 处理 `.`/`..`/绝对/相对。
 * - 不支持管道 `|` / 重定向 `>`（本轮范围外）。
 *
 * 参考思路：openspecui core/src/config.ts 的 tokenizeCliCommand。
 */

import type { Vfs, VfsNode } from "$lib/vfs/vfs";

// ---------------------------------------------------------------------------
// Tokenizer：空格分词 + 单/双引号
// ---------------------------------------------------------------------------

/**
 * 把一行命令拆成 argv。
 * - 空白分隔
 * - 单引号：原样保留（内部无转义）
 * - 双引号：原样保留（不支持 $ 等展开）
 * - 反斜杠：转义下一个字符（引号内外都生效）
 * - 末尾未闭合的引号视为延伸到行尾（容错）
 */
export function tokenize(line: string): string[] {
  const args: string[] = [];
  let cur = "";
  let inSingle = false;
  let inDouble = false;
  let hasToken = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === "\\" && i + 1 < line.length) {
      // 反斜杠转义：保留下一个字符原样
      cur += line[i + 1];
      hasToken = true;
      i++;
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      hasToken = true;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      hasToken = true;
      continue;
    }

    const isSpace = ch === " " || ch === "\t";
    if (isSpace && !inSingle && !inDouble) {
      if (hasToken) {
        args.push(cur);
        cur = "";
        hasToken = false;
      }
      continue;
    }

    cur += ch;
    hasToken = true;
  }

  if (hasToken) args.push(cur);
  return args;
}

// ---------------------------------------------------------------------------
// 路径解析
// ---------------------------------------------------------------------------

/**
 * 把用户输入的 arg 解析成 VFS 仓库根相对路径。
 * - `/foo` → `foo`（去掉前导斜杠，VFS 是仓库根相对）
 * - 相对路径基于 cwd 拼接
 * - `.` / `..` 段会被规范（`..` 弹出上一级，但不能超过根）
 * - 空字符串 / `.` → cwd 本身
 */
export function resolvePath(cwd: string, arg: string): string {
  const input = arg.trim();
  // 是否绝对（以 / 开头）—— 绝对即"从仓库根算"
  const isAbsolute = input.startsWith("/");
  const segments = (isAbsolute ? input.slice(1) : input).split("/");
  const base = isAbsolute ? [] : cwd.split("/").filter(Boolean);

  for (const seg of segments) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      base.pop();
      continue;
    }
    base.push(seg);
  }
  return base.join("/");
}

/** 把 cwd 规范化展示（带前导斜杠，便于 prompt 渲染）。 */
export function prettyCwd(cwd: string): string {
  const c = cwd.replace(/^\/+|\/+$/g, "");
  return c ? `/${c}` : "/";
}

// ---------------------------------------------------------------------------
// 命令上下文与接口
// ---------------------------------------------------------------------------

/**
 * 命令执行上下文。
 * `write` 输出普通文本（不带换行，调用方自行 `\r\n`），`writeErr` 带红色 ANSI。
 */
export interface CommandContext {
  /** 当前工作目录（VFS 相对路径，无前导斜杠）。 */
  cwd: string;
  /** VFS 单例。 */
  vfs: Vfs;
  /** 输出到终端（不带换行）。 */
  write: (s: string) => void;
  /** 输出错误（ANSI 红色，不带换行）。 */
  writeErr: (s: string) => void;
  /** 请求清屏（clear 命令用）。 */
  clear: () => void;
}

/** 命令退出码（0 = 成功）。 */
export type ExitCode = number;

export interface Command {
  name: string;
  /** 用法简述（help 列表用）。 */
  usage: string;
  /** 较详细的说明（help <cmd> 用）。 */
  description: string;
  /** 执行。args[0] 是命令名本身，args[1..] 是参数。 */
  run: (ctx: CommandContext, args: string[]) => Promise<ExitCode>;
}

// ---------------------------------------------------------------------------
// ANSI 颜色（最小集）
// ---------------------------------------------------------------------------

export const ANSI = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  bold: "\x1b[1m",
} as const;

/** 输出工具：自动加 \r\n（终端换行需要 CR+LF）。 */
export const Term = {
  newline: "\r\n",
  line: (s = "") => `${s}\r\n`,
  err: (s: string) => `${ANSI.red}${s}${ANSI.reset}`,
};

// ---------------------------------------------------------------------------
// 内置命令实现
// ---------------------------------------------------------------------------

/** 列出一个前缀下"直接子项"（文件 + 目录）。 */
function listDirectChildren(
  nodes: VfsNode[],
  prefix: string,
): { dirs: Set<string>; files: VfsNode[] } {
  const dirs = new Set<string>();
  const files: VfsNode[] = [];
  const normalized = prefix.replace(/\/+$/, "");

  for (const node of nodes) {
    if (normalized) {
      if (!node.path.startsWith(normalized + "/")) continue;
      const rest = node.path.slice(normalized.length + 1);
      const slash = rest.indexOf("/");
      if (slash === -1) {
        files.push(node);
      } else {
        dirs.add(rest.slice(0, slash));
      }
    } else {
      const slash = node.path.indexOf("/");
      if (slash === -1) {
        files.push(node);
      } else {
        dirs.add(node.path.slice(0, slash));
      }
    }
  }
  return { dirs, files };
}

const lsCommand: Command = {
  name: "ls",
  usage: "ls [path]",
  description: "列出目录内容。默认列出当前目录。",
  async run(ctx, args) {
    const target = resolvePath(ctx.cwd, args[1] ?? ".");
    const all = await ctx.vfs.readdir("", { recursive: true });
    const { dirs, files } = listDirectChildren(all, target);

    const entries: string[] = [];
    for (const d of [...dirs].sort()) {
      entries.push(`${ANSI.blue}${d}/${ANSI.reset}`);
    }
    for (const f of files.sort((a, b) => a.path.localeCompare(b.path))) {
      const name = target ? f.path.slice(target.length + 1) : f.path;
      if (f.dirty) {
        entries.push(`${ANSI.yellow}${name}${ANSI.reset}`);
      } else {
        entries.push(name);
      }
    }

    if (entries.length === 0) {
      // 空目录不报错（bash ls 空目录也不报错）
      return 0;
    }
    ctx.write(entries.join("  ") + Term.newline);
    return 0;
  },
};

const catCommand: Command = {
  name: "cat",
  usage: "cat <path>",
  description: "输出文件内容。",
  async run(ctx, args) {
    if (!args[1]) {
      ctx.write(Term.err("cat: 缺少文件参数") + Term.newline);
      return 1;
    }
    const path = resolvePath(ctx.cwd, args[1]);
    try {
      const content = await ctx.vfs.readFile(path);
      ctx.write(content + (content.endsWith("\n") ? "\r" : "") + Term.newline);
      return 0;
    } catch {
      ctx.write(Term.err(`cat: ${args[1]}: 文件不存在`) + Term.newline);
      return 1;
    }
  },
};

const echoCommand: Command = {
  name: "echo",
  usage: "echo <text...>",
  description: "回显文本。",
  async run(ctx, args) {
    // 把 tokenize 合并的参数重新用空格拼接（近似还原，丢失原引号信息可接受）
    ctx.write(args.slice(1).join(" ") + Term.newline);
    return 0;
  },
};

const rmCommand: Command = {
  name: "rm",
  usage: "rm <path>",
  description: "删除文件（软删除，标记 dirty，提交后生效）。",
  async run(ctx, args) {
    if (!args[1]) {
      ctx.write(Term.err("rm: 缺少文件参数") + Term.newline);
      return 1;
    }
    const path = resolvePath(ctx.cwd, args[1]);
    const stat = await ctx.vfs.stat(path);
    if (!stat) {
      ctx.write(Term.err(`rm: ${args[1]}: 文件不存在`) + Term.newline);
      return 1;
    }
    await ctx.vfs.unlink(path);
    return 0;
  },
};

const touchCommand: Command = {
  name: "touch",
  usage: "touch <path>",
  description: "创建空文件（若不存在），或刷新已存在文件的 mtime。",
  async run(ctx, args) {
    if (!args[1]) {
      ctx.write(Term.err("touch: 缺少文件参数") + Term.newline);
      return 1;
    }
    const path = resolvePath(ctx.cwd, args[1]);
    const stat = await ctx.vfs.stat(path);
    if (!stat) {
      await ctx.vfs.writeFile(path, "");
      return 0;
    }
    // 已存在：VFS 没有 touch，重写内容刷新 mtime（保持内容不变）
    const content = await ctx.vfs.readFile(path);
    await ctx.vfs.writeFile(path, content);
    return 0;
  },
};

const writeCommand: Command = {
  name: "write",
  usage: "write <path> <content...>",
  description:
    "写入文件（自定义命令，等价于 echo > file，但本轮不支持重定向）。",
  async run(ctx, args) {
    if (!args[1]) {
      ctx.write(Term.err("write: 用法: write <path> <content>") + Term.newline);
      return 1;
    }
    const path = resolvePath(ctx.cwd, args[1]);
    const content = args.slice(2).join(" ");
    await ctx.vfs.writeFile(path, content);
    return 0;
  },
};

const statCommand: Command = {
  name: "stat",
  usage: "stat <path>",
  description: "显示文件元数据。",
  async run(ctx, args) {
    if (!args[1]) {
      ctx.write(Term.err("stat: 缺少文件参数") + Term.newline);
      return 1;
    }
    const path = resolvePath(ctx.cwd, args[1]);
    const node = await ctx.vfs.stat(path);
    if (!node) {
      ctx.write(Term.err(`stat: ${args[1]}: 文件不存在`) + Term.newline);
      return 1;
    }
    ctx.write(
      [
        `  文件: ${args[1]}`,
        `  路径: ${node.path}`,
        `  来源: ${node.origin}`,
        `  状态: ${node.dirty ? `${ANSI.yellow}已修改${ANSI.reset}` : "干净"}`,
        `  sha: ${node.sha ?? "(无)"}`,
        `  修改时间: ${new Date(node.mtime).toISOString()}`,
      ].join(Term.newline) + Term.newline,
    );
    return 0;
  },
};

const findCommand: Command = {
  name: "find",
  usage: "find [path] [-name pattern]",
  description: "递归列出路径下所有文件。可选 -name 过滤（子串匹配）。",
  async run(ctx, args) {
    // 简化解析：第一个非 -name 参数是 path，-name 后的参数是 pattern
    const positional: string[] = [];
    let pattern: string | null = null;
    for (let i = 1; i < args.length; i++) {
      if (args[i] === "-name") {
        pattern = args[i + 1] ?? null;
        i++;
      } else {
        positional.push(args[i]);
      }
    }
    const base = resolvePath(ctx.cwd, positional[0] ?? ".");
    const all = await ctx.vfs.readdir(base, { recursive: true });
    const lines = all
      .map((n) => (base ? n.path.slice(base.length + 1) : n.path))
      .filter((p) => !pattern || p.includes(pattern))
      .sort();
    if (lines.length === 0) return 0;
    ctx.write(lines.join(Term.newline) + Term.newline);
    return 0;
  },
};

const pwdCommand: Command = {
  name: "pwd",
  usage: "pwd",
  description: "显示当前工作目录。",
  async run(ctx) {
    ctx.write(prettyCwd(ctx.cwd) + Term.newline);
    return 0;
  },
};

// cd 不走标准 Command run（它要改 ctx.cwd，但 cwd 是值类型）。
// 用一个特殊处理器，runLine 识别 cd 后直接 mutate ctx.cwd。
const cdCommand: Command = {
  name: "cd",
  usage: "cd [path]",
  description: "切换当前目录（仅会话内，不持久化）。",
  async run(ctx, args) {
    // 占位：实际 cd 逻辑在 runLine 里 mutate cwd（见 runLine 的 cd 特判）
    void ctx;
    void args;
    return 0;
  },
};

const clearCommand: Command = {
  name: "clear",
  usage: "clear",
  description: "清屏。",
  async run(ctx) {
    ctx.clear();
    return 0;
  },
};

const helpCommand: Command = {
  name: "help",
  usage: "help [command]",
  description: "显示命令列表或某命令的详细说明。",
  async run(ctx, args) {
    const registry = getRegistry();
    if (args[1]) {
      const cmd = registry.get(args[1]);
      if (cmd) {
        ctx.write(
          `${ANSI.bold}${cmd.usage}${ANSI.reset}${Term.newline}${cmd.description}${Term.newline}`,
        );
        return 0;
      }
      // git 子命令
      if (args[1] === "git") {
        ctx.write(
          `${ANSI.bold}git${ANSI.reset} — 子命令：status / commit / pull${Term.newline}` +
            `  git status    ${ANSI.gray}显示未提交修改${ANSI.reset}${Term.newline}` +
            `  git commit -m "msg"    ${ANSI.gray}提交到 GitHub${ANSI.reset}${Term.newline}` +
            `  git pull    ${ANSI.gray}同步 src/content 子树${ANSI.reset}${Term.newline}`,
        );
        return 0;
      }
      ctx.write(Term.err(`help: 未知命令: ${args[1]}`) + Term.newline);
      return 1;
    }
    const lines: string[] = [`${ANSI.bold}可用命令：${ANSI.reset}`];
    for (const cmd of [...registry.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      lines.push(
        `  ${ANSI.cyan}${cmd.name.padEnd(10)}${ANSI.reset} ${cmd.usage}`,
      );
    }
    // git 子命令单列（不在 registry，避免 Tab 补全污染）
    lines.push(
      `  ${ANSI.cyan}git       ${ANSI.reset}git status | commit | pull`,
    );
    lines.push(
      `${ANSI.gray}提示：用 ↑↓ 切换历史，Tab 补全文件名/命令。${ANSI.reset}`,
    );
    ctx.write(lines.join(Term.newline) + Term.newline);
    return 0;
  },
};

// ---- git 子命令 ----
// git 命令实现归属 github 应用（installable/github/commands.ts），
// 通过 manifest.cliCommands 声明，实现走 GitService（鉴权 + 类型化错误）。
// git 是聚合命令，runLine 对 "git" 特判分发到 gitSubcommandMap，不进通用 registry。
// 延迟 import 避免循环依赖（commands.ts → gitService → os/services → AppManager → shell）。
type GitSubMap = Map<
  string,
  {
    run: (
      ctx: CommandContext,
      args: string[],
    ) => Promise<{ exit: number; newCwd: string | null }>;
  }
>;
let _gitSubmapCache: GitSubMap | null = null;
async function getGitSubmap(): Promise<GitSubMap> {
  if (!_gitSubmapCache) {
    const mod = await import("$lib/apps/installable/github/commands");
    _gitSubmapCache = mod.gitSubcommandMap as unknown as GitSubMap;
  }
  return _gitSubmapCache;
}

// ---------------------------------------------------------------------------
// 注册表（内置命令 + PATH 注册命令）
// ---------------------------------------------------------------------------

/** PATH 注册的命令（应用安装时注册）。 */
const pathCommands = new Map<string, Command>();

const builtins: Command[] = [
  lsCommand,
  catCommand,
  echoCommand,
  rmCommand,
  touchCommand,
  writeCommand,
  statCommand,
  findCommand,
  pwdCommand,
  cdCommand,
  clearCommand,
  helpCommand,
];

const registry = new Map<string, Command>();
for (const cmd of builtins) registry.set(cmd.name, cmd);

/** 注册 PATH 命令（应用安装时调用）。 */
export function registerPathCommand(command: Command): void {
  pathCommands.set(command.name, command);
}

/** 注销 PATH 命令（应用卸载时调用）。 */
export function unregisterPathCommand(name: string): void {
  pathCommands.delete(name);
}

/** 获取合并后的注册表（内置 + PATH）。 */
export function getRegistry(): Map<string, Command> {
  const merged = new Map<string, Command>(registry);
  for (const [name, cmd] of pathCommands) {
    merged.set(name, cmd);
  }
  return merged;
}

// ---------------------------------------------------------------------------
// 主入口：执行一行命令
// ---------------------------------------------------------------------------

export interface RunResult {
  /** 进程退出码（0 = 成功）。 */
  exit: ExitCode;
  /** cd 命令请求切换到的新 cwd（null 表示不变）。 */
  newCwd: string | null;
}

/**
 * 执行一行命令。
 *
 * @param ctx 命令上下文（cwd 不会被修改，cd 的结果通过返回值 newCwd 传回）
 * @param line 用户输入的原始行
 */
export async function runLine(
  ctx: CommandContext,
  line: string,
): Promise<RunResult> {
  const args = tokenize(line);
  if (args.length === 0) {
    return { exit: 0, newCwd: null };
  }

  const name = args[0];

  // git 作为聚合命令分发到 gitSubcommandMap（命令实现归属 github 应用）
  if (name === "git") {
    const sub = args[1] ?? "status";
    const submap = await getGitSubmap();
    const target = submap.get(sub);
    if (!target) {
      ctx.write(
        Term.err(`git: 不支持子命令 '${sub}'。可用：status / commit / pull`) +
          Term.newline,
      );
      return { exit: 1, newCwd: null };
    }
    // 重写 args 让目标命令看到正确 argv：[git, sub, ...rest]
    const rest = [name, sub, ...args.slice(2)];
    // CliCommand.run 返回 { exit, newCwd }；git 命令不改 cwd
    const result = await target.run(ctx, rest);
    return { exit: result.exit, newCwd: null };
  }

  // cd 特判（mutate cwd）
  if (name === "cd") {
    const target = args[1] ? resolvePath(ctx.cwd, args[1]) : "";
    // 验证目标是否是"目录"（VFS 没有显式目录，只要存在以此为前缀的文件就算目录）
    if (target) {
      const all = await ctx.vfs.readdir("", { recursive: true });
      const isDir = all.some(
        (n) => n.path === target || n.path.startsWith(target + "/"),
      );
      const isFile = all.some((n) => n.path === target);
      if (!isDir || isFile) {
        ctx.write(Term.err(`cd: ${args[1]}: 不是目录`) + Term.newline);
        return { exit: 1, newCwd: null };
      }
    }
    return { exit: 0, newCwd: target };
  }

  const cmd = getRegistry().get(name);
  if (!cmd) {
    ctx.write(
      Term.err(`${name}: 命令未找到。输入 help 查看可用命令。`) + Term.newline,
    );
    return { exit: 127, newCwd: null };
  }

  const exit = await cmd.run(ctx, args);
  return { exit, newCwd: null };
}

/**
 * Tab 补全：给定当前单词，返回候选列表。
 * - 命令名补全（行首）
 * - 路径补全（命令参数）
 */
export async function tabComplete(
  ctx: CommandContext,
  line: string,
): Promise<string[]> {
  // 简化：找到最后一个 token 的起点
  const match = line.match(/(\S*)$/);
  const current = match ? match[1] : "";
  const isCommandPosition = line.trim() === current && !line.includes(" ");

  if (isCommandPosition) {
    // 补全命令名（内置 + PATH 命令）
    const reg = getRegistry();
    return [...reg.keys()].filter((n) => n.startsWith(current));
  }

  // 路径补全：基于 cwd 解析 current 的目录部分
  const slashIdx = current.lastIndexOf("/");
  const dirPart = slashIdx >= 0 ? current.slice(0, slashIdx) : "";
  const filePart = slashIdx >= 0 ? current.slice(slashIdx + 1) : current;
  const resolvedDir = resolvePath(ctx.cwd, dirPart || ".");

  const all = await ctx.vfs.readdir("", { recursive: true });
  const candidates: string[] = [];
  const seenDirs = new Set<string>();
  for (const n of all) {
    if (resolvedDir && !n.path.startsWith(resolvedDir + "/")) continue;
    const rest = resolvedDir ? n.path.slice(resolvedDir.length + 1) : n.path;
    const slash = rest.indexOf("/");
    if (slash === -1) {
      if (rest.startsWith(filePart)) {
        candidates.push((dirPart ? dirPart + "/" : "") + rest);
      }
    } else {
      const d = rest.slice(0, slash);
      if (!seenDirs.has(d) && d.startsWith(filePart)) {
        seenDirs.add(d);
        candidates.push((dirPart ? dirPart + "/" : "") + d + "/");
      }
    }
  }
  return candidates.sort();
}
