#!/usr/bin/env bun
/**
 * pipeline-env-doctor — gaubee-skills 每日管道运行环境自检
 *
 * 背景（2026-10-09 实证）：cron 可能在裁剪版 PATH 下启动，当天 bun/node/ego-browser
 * 全部 command not found，六源抓取在第一步就中断，靠手动补 PATH 才跑通。本工具把
 * 「管道能不能跑」变成一条命令的体检，并给出缺失项的修复提示。
 *
 * 检查项：
 *   1. 必需二进制在 PATH 可达（bun/node/gh/git/curl/jq + 可选 ego-browser/yt-dlp/ffprobe）；
 *   2. gh 登录态（gh auth status，只看退出码不读内容）；
 *   3. 私有数据根存在且可写（~/.gaubee-skills/）；
 *   4. .env 存在且关键 KEY 名齐全（只检查键名存在，绝不输出值）。
 *
 * 用法：
 *   bun pipeline-env-doctor.ts              # 全量体检，缺失项退出 1
 *   bun pipeline-env-doctor.ts --json       # 机器可读输出
 *
 * 零第三方依赖。
 */

import { spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
  hint?: string;
}

const required = ["bun", "node", "gh", "git", "curl", "jq"] as const;
const optional = ["ego-browser", "yt-dlp", "ffprobe"] as const;
const envKeys = ["GAUBEE_SKILLS_VAULT_KEY"] as const;

const checks: Check[] = [];

const binDir = (name: string): string | null => {
  const r = spawnSync("bash", ["-lc", `command -v ${name}`], { encoding: "utf8" });
  const p = r.stdout.trim();
  return r.status === 0 && p ? p : null;
};

for (const b of required) {
  const p = binDir(b);
  checks.push({
    name: `bin:${b}`,
    ok: p !== null,
    detail: p ?? "PATH 上不可达",
    hint: p ? undefined : "缺它管道必断；按 ~/.zshenv 的 vite-plus/.bun/.local/bin 补 PATH",
  });
}
for (const b of optional) {
  const p = binDir(b);
  checks.push({
    name: `bin(可选):${b}`,
    ok: p !== null,
    detail: p ?? "缺失（对应软依赖降级，不阻塞管道）",
    hint: p ? undefined : b === "ego-browser" ? "export PATH=\"$HOME/.local/bin:$PATH\"" : "yt-dlp/ffprobe 缺失时视频兜底/尺寸元数据降级",
  });
}

let gh: ReturnType<typeof spawnSync>;
try {
  gh = spawnSync("gh", ["auth", "status"], { encoding: "utf8", stdio: "pipe" });
  const ok = gh.status === 0;
  checks.push({ name: "gh:auth", ok, detail: ok ? "已登录" : "未登录或 token 失效", hint: ok ? undefined : "gh auth login" });
} catch {
  checks.push({ name: "gh:auth", ok: false, detail: "gh 不可执行" });
}

const dataRoot = process.env.GAUBEE_SKILLS_DATA ?? join(homedir(), ".gaubee-skills");
let writable = false;
try {
  accessSync(dataRoot, constants.W_OK);
  writable = true;
} catch {
  writable = false;
}
checks.push({
  name: "data:root 可写",
  ok: writable,
  detail: writable ? dataRoot : `${dataRoot} 不存在或不可写`,
  hint: writable ? undefined : "mkdir -p 该目录并确认磁盘可写",
});

const envPath = join(dataRoot, ".env");
if (existsSync(envPath)) {
  const content = readFileSync(envPath, "utf8");
  for (const k of envKeys) {
    const has = new RegExp(`^\\s*${k}\\s*=`, "m").test(content);
    checks.push({ name: `env:${k}`, ok: has, detail: has ? "键存在（值不读取）" : "键缺失", hint: has ? undefined : "补进 ~/.gaubee-skills/.env" });
  }
} else {
  checks.push({ name: "env:.env", ok: false, detail: `${envPath} 不存在`, hint: "从密码管理器恢复 .env" });
}

const failed = checks.filter((c) => !c.ok);
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
} else {
  console.log(`pipeline-env-doctor：${checks.length} 项检查`);
  for (const c of checks) {
    console.log(`  ${c.ok ? "ok  " : "FAIL"} ${c.name}  ${c.detail}${c.hint && !c.ok ? `\n       hint: ${c.hint}` : ""}`);
  }
  console.log(failed.length === 0 ? "\nOK：管道环境就绪" : `\n${failed.length} 项不就绪（管道会部分或全部中断）`);
}
process.exit(failed.length === 0 ? 0 : 1);
