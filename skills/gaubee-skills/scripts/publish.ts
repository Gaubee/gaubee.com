#!/usr/bin/env bun
import { execSync } from "node:child_process";
/**
 * publish.ts — 把 gaubee-skills 的报告发布为 gaubee.com 的 event
 *
 * 文件意图（正交意图清单）：
 * - [2026-10-03] 原始需求（kzf）：日报/周报/月报甚至年报，自动汇总到 ~/Dev/Github/gaubee.com，在那里发布 events。
 * - 1. 序号自增（读 src/content/events 最大五位序号）+ 站点 front-matter 规范（title/date/tags）写新 event md
 * - 2. 显式路径 git add + 中文提交（📰 前缀）+ push origin main（push 即触发 CI 构建镜像与 1Panel 自动拉取，详见站点 agents.md）
 *
 * 安全护栏：分支必须 main、无已修改跟踪文件（未跟踪文件不碍事）、不落后远端（落后即中止）；
 * 只 add 本次生成的单个文件，绝不碰站点其它内容。
 * 用法：bun scripts/publish.ts <报告md> --title "信号日报 2026-10-04" --slug signals-daily-2026-10-04 --tags signals [--dry]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { writeFileAtomic } from "./lib.ts";

// 本 skill 已迁入站点仓库（2026-10-05）：skills/gaubee-skills/scripts 上三级即仓库根；
// GAUBEE_SITE 可覆盖（跨 checkout 场景）
const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..");
const EVENTS = path.join(SITE, "src", "content", "events");

interface Args {
  report: string;
  title: string;
  slug: string;
  tags: string[];
  dry: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { report: "", title: "", slug: "", tags: ["signals"], dry: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--title") args.title = argv[++i] ?? "";
    else if (a === "--slug") args.slug = argv[++i] ?? "";
    else if (a === "--tags") args.tags = ["event", ...(argv[++i] ?? "").split(",").filter(Boolean)];
    else if (a === "--dry") args.dry = true;
    else args.report = a;
  }
  if (!args.report || !args.slug) {
    console.error(
      "用法：publish.ts <报告md> --slug <kebab-slug> [--title <标题>] [--tags a,b] [--dry]",
    );
    process.exit(2);
  }
  if (!args.title) args.title = args.slug;
  return args;
}

function git(cwd: string, cmd: string): string {
  return execSync(`git ${cmd}`, { cwd, encoding: "utf8" }).trim();
}

/** 护栏检查，返回错误信息或空串 */
function preflight(): string {
  if (!existsSync(path.join(SITE, ".git"))) return `站点仓库不存在：${SITE}`;
  if (git(SITE, "rev-parse --abbrev-ref HEAD") !== "main")
    return "站点仓库当前不在 main 分支，中止";
  const status = git(SITE, "status --porcelain");
  const dirtyTracked = status.split("\n").filter((l) => l && !l.startsWith("??"));
  if (dirtyTracked.length)
    return `站点仓库有未提交的跟踪文件改动，中止：\n${dirtyTracked.join("\n")}`;
  execSync("git fetch origin main", { cwd: SITE, stdio: "pipe" });
  const behind = git(SITE, "rev-list HEAD..origin/main --count");
  if (behind !== "0") return `站点 main 落后远端 ${behind} 个提交，请先同步，中止`;
  return "";
}

function nextSerial(): string {
  const max = readdirSync(EVENTS)
    .map((f) => Number.parseInt(f.slice(0, 5), 10))
    .filter((n) => !Number.isNaN(n))
    .reduce((a, b) => Math.max(a, b), 0);
  return String(max + 1).padStart(5, "0");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const reportPath = path.resolve(args.report);
  if (!existsSync(reportPath)) {
    console.error(`报告不存在：${reportPath}`);
    process.exit(1);
  }
  const problem = preflight();
  if (problem) {
    console.error(`PREFLIGHT-FAIL ${problem}`);
    process.exit(1);
  }

  const serial = nextSerial();
  const fileName = `${serial}.${args.slug}.md`;
  const raw = readFileSync(reportPath, "utf8");
  // frontmatter 直通（2026-10-09 X 日报卡片化）：生成器产物自带 frontmatter
  //（title/date/tags 已是权威值），直通不再包第二层——旧手写报告无 frontmatter 时
  // 仍按 --title/--tags 包一层（历史行为不变）。
  const fmRe = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
  const hasFrontmatter = fmRe.test(raw);
  const body = hasFrontmatter ? raw.replace(fmRe, "") : raw;
  const front = hasFrontmatter
    ? ""
    : [
        "---",
        `title: ${args.title}`,
        `date: "${new Date().toISOString()}"`,
        "tags:",
        ...args.tags.map((t) => `  - ${t}`),
        "---",
        "",
      ].join("\n");
  const content = `${front}${body}\n`;

  if (args.dry) {
    console.log(
      `DRY 将写入 ${path.join(EVENTS, fileName)}（${content.length} 字节），随后 commit + push origin main`,
    );
    return;
  }

  mkdirSync(EVENTS, { recursive: true });
  const target = path.join(EVENTS, fileName);
  writeFileAtomic(target, content);
  git(SITE, `add src/content/events/${fileName}`);
  git(SITE, `commit -m "📰 ${fileName} gaubee-skills 自动发布"`);
  const pushOut = git(SITE, "push origin main");
  const sha = git(SITE, "rev-parse --short HEAD");
  console.log(`published ${fileName} @ commit ${sha}`);
  console.log(pushOut.split("\n").slice(-3).join("\n"));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
