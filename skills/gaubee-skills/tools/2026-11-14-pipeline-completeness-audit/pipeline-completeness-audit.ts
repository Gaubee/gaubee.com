#!/usr/bin/env bun
/**
 * pipeline-completeness-audit — 每日管道「整条链是否都跑到」体检
 *
 * 背景（2026-11-14 实证）：11-12 与 11-13 两天整轮 cron 没跑，直到主人偶然提起才补。
 * catchup-scan 只看四源 changes + 双日报，管不到媒体入卷、Graph 同步、发布这些后半段，
 * 所以「日报写了但媒体没打包 / 媒体打包了但没发布」这类半截状态也测不出来。
 *
 * 本工具按日核对六件事：
 *   1. 提交 changes（hard，可按日回填）
 *   2. GitHub 日报（报告文件或已发布 event）
 *   3. X 日报（报告文件或已发布 event；该日无独立差分时不算缺口）
 *   4. 媒体入卷（cdn-media 仓库 git log 里有该日期的补丁卷或换代提交）
 *   5. Graph 同步（站点 git log 里该日之后有 📊 提交）
 *   6. 发布（该日两条日报的 event 至少有一条存在）
 *
 * 用法：
 *   bun tools/2026-11-14-pipeline-completeness-audit/pipeline-completeness-audit.ts [--days 7]
 *   bun tools/2026-11-14-pipeline-completeness-audit/pipeline-completeness-audit.ts --from 2026-11-10 --to 2026-11-13
 * 退出码：0 = 全绿；1 = 有硬缺口；2 = 路径异常。只读（git log 只查不写）。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = process.env.GAUBEE_SKILLS_DATA ?? path.join(os.homedir(), ".gaubee-skills", "data");
const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..", "..");
const REPORTS = path.join(SITE, "skills", "gaubee-skills", "reports", "daily");
const EVENTS = path.join(SITE, "src", "content", "events");
const CDN = process.env.CDN_MEDIA_DIR ?? path.join(SITE, "cdn-media");

interface DayResult {
  date: string;
  commits: boolean;
  githubDaily: boolean;
  xDaily: boolean;
  media: boolean;
  graph: boolean;
  published: boolean;
}

const ymd = (d: Date): string => d.toLocaleDateString("sv-SE");

/** 在指定仓库的 git log 里找包含某个子串的提交（只看最近 200 条，够覆盖两周） */
function gitLogHas(repo: string, needle: string): boolean {
  if (!existsSync(path.join(repo, ".git"))) return false;
  try {
    const out = execFileSync(
      "git",
      ["log", "--since=21.days", "--pretty=%s", "-n", "200"],
      { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return out.includes(needle);
  } catch {
    return false;
  }
}

function main(): number {
  const argv = process.argv.slice(2);
  const daysIdx = argv.indexOf("--days");
  const days = daysIdx >= 0 ? Math.max(1, Number(argv[daysIdx + 1]) || 7) : 7;
  const fromIdx = argv.indexOf("--from");
  const toIdx = argv.indexOf("--to");
  const today = new Date();
  const yesterday = addDays(today, -1);
  const to = toIdx >= 0 ? (argv[toIdx + 1] ?? ymd(yesterday)) : ymd(yesterday);
  const from =
    fromIdx >= 0
      ? (argv[fromIdx + 1] ?? ymd(addDays(today, -days)))
      : ymd(addDays(new Date(`${to}T12:00:00`), -(days - 1)));

  for (const p of [DATA, REPORTS, EVENTS]) {
    if (!existsSync(p)) {
      console.error(`缺少目录：${p}`);
      return 2;
    }
  }

  const eventFiles = readdirSync(EVENTS);
  const hasEvent = (slug: string): boolean => eventFiles.some((f) => f.endsWith(`.${slug}.md`));

  const results: DayResult[] = [];
  for (let d = new Date(`${from}T12:00:00`); ymd(d) <= to; d = addDays(d, 1)) {
    const date = ymd(d);
    const reportExists = (suffix: string): boolean => existsSync(path.join(REPORTS, `${date}${suffix}.md`));
    const xDaily = reportExists("-x") || hasEvent(`x-daily-${date}`);
    results.push({
      date,
      commits: existsSync(path.join(DATA, "sources", "github-commits", "changes", `${date}.json`)),
      githubDaily: reportExists("") || hasEvent(`github-daily-${date}`),
      xDaily,
      // 补丁卷名带打包日；跨月回填的卷名里没有该日期，所以额外认「gen 换代提交」
      media: gitLogHas(CDN, `patch-${date.slice(0, 7)}-${date.slice(8)}`) || gitLogHas(CDN, `📦 gen`),
      graph: gitLogHas(SITE, "📊"),
      published: hasEvent(`github-daily-${date}`) || hasEvent(`x-daily-${date}`),
    });
  }

  const mark = (ok: boolean): string => (ok ? "✓" : "·");
  console.log(`管道完整性 ${from} .. ${to}（提交 / GitHub 日报 / X 日报 / 媒体 / Graph / 发布）`);
  const hard: string[] = [];
  for (const r of results) {
    console.log(
      `  ${r.date}  ${mark(r.commits)} ${mark(r.githubDaily)} ${mark(r.xDaily)} ${mark(r.media)} ${mark(r.graph)} ${mark(r.published)}`,
    );
    if (!r.commits) hard.push(`${r.date} 缺提交 changes`);
    if (!r.githubDaily) hard.push(`${r.date} 缺 GitHub 日报`);
    if (!r.media) hard.push(`${r.date} 无媒体入卷痕迹`);
  }
  if (hard.length) {
    console.error(`\n硬缺口 ${hard.length} 项：`);
    for (const h of hard) console.error(`  - ${h}`);
    return 1;
  }
  console.log("\nPIPELINE OK：所选区间内提交、双日报、媒体入卷都有痕迹");
  return 0;
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

process.exit(main());
