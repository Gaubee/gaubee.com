#!/usr/bin/env bun
/**
 * x-daily-backfill.ts — X 日报缺口检测与补跑清单（工具工坊 2026-10-11）
 *
 * 解决什么：2026-10-10 的 X 日报因媒体闸门顺延，10-09 的日报缺口靠人记人补。
 * 本工具扫描 events 目录，列出「有 x-archive 覆盖（=当日确有互动）但缺 x-daily 日报」
 * 的日期，并给出每个缺口的差分运行日建议（= 报告日 +1，逐日验证 changes 文件存在），
 * 直接输出可复制的补跑命令。
 *
 * 怎么跑：bun tools/2026-10-11-x-daily-backfill/x-daily-backfill.ts [--limit N]
 * 退出码：0 = 无缺口；1 = 有缺口（清单见输出，供 cron/人工补跑）。
 * 口径：x-daily-<D>.md 不存在于 EVENTS_DIR，且存在该日的 x-archive（有互动才归档）。
 * 差分运行日：changes/<D+1>.json 存在则 D+1；否则逐日向后探测最近一个存在的 changes
 * 文件（停跑回填场景），全不存在则标记「差分不可用，需先回填抓取」。
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const limitIdx = argv.indexOf("--limit");
const limit = limitIdx > -1 ? Number.parseInt(argv[limitIdx + 1] ?? "10", 10) : 10;

const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..", "..");
const EVENTS_DIR = path.join(SITE, "src", "content", "events");
const DATA = process.env.GAUBEE_SKILLS_DATA ?? path.join(process.env.HOME!, ".gaubee-skills", "data");
const CHANGES = path.join(DATA, "sources", "x-likes", "changes");

const files = readdirSync(EVENTS_DIR);
const archives = new Set<string>();
const dailies = new Set<string>();
for (const f of files) {
  const a = f.match(/x-archive-(\d{4}-\d{2}-\d{2})\.md$/);
  if (a) archives.add(a[1]!);
  const d = f.match(/x-daily-(\d{4}-\d{2}-\d{2})\.md$/);
  if (d) dailies.add(d[1]!);
}

const plus1 = (d: string): string => {
  const dt = new Date(`${d}T12:00:00`);
  dt.setDate(dt.getDate() + 1);
  return dt.toISOString().slice(0, 10);
};

// 缺口口径：日报制度起点（最早的 x-daily）之后的归档日才可能有日报义务；
// 今天及未来日期属于未来任务，不算缺口
const today = (() => {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
})();
const eraStart = [...dailies].sort()[0];
const gaps = eraStart
  ? [...archives].filter((d) => !dailies.has(d) && d >= eraStart && d < today).sort()
  : [];
if (!eraStart) console.log("尚无任何 x-daily：日报制度未启动，无可检缺口");
if (gaps.length === 0) {
  console.log("无缺口：每个有互动的归档日都有对应 X 日报");
  process.exit(0);
}
console.log(`发现 ${gaps.length} 个日报缺口（有归档无日报）：`);
for (const d of gaps.slice(0, limit)) {
  let run = plus1(d);
  let probe = 0;
  while (!existsSync(path.join(CHANGES, `${run}.json`)) && probe < 7) {
    run = plus1(run);
    probe++;
  }
  const diffOk = existsSync(path.join(CHANGES, `${run}.json`));
  const force = existsSync(path.join(EVENTS_DIR, `x-daily-${d}.md`)) ? " --force" : "";
  const cmd = diffOk
    ? `bun scripts/x-daily-events.ts --date ${d} --run-date ${run}${force}`
    : `（差分不可用：先补跑 x-likes-fetch 覆盖 ${d} 之后的抓取）`;
  console.log(`  ${d}（归档 ${archives.has(d) ? "有" : "无"}）→ ${cmd}`);
}
if (gaps.length > limit) console.log(`  … 其余 ${gaps.length - limit} 个缺口未列出（--limit 调整）`);
process.exit(1);
