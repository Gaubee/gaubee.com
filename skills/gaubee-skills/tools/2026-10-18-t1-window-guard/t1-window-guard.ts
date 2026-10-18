// t1-window-guard.ts — T-1 归窗守卫（工坊 2026-10-18 提案 2）
//
// 动机（2026-10-18 实证）：cron 运行把周日误当周一，生成了「今天」的 X 日报
//（--date 2026-10-18 @ run-date 2026-10-18），把过去 24h 差分整体错归一天，
// GitHub 日报也写成了今天。T-1 语义只有一条硬规则：**报告日必须早于差分运行日**；
// 常规晨间 cron 下报告日 = run-date 的昨天。
//
// 做什么：给定 --date（报告日）与 --run-date（差分运行日，缺省今天），
// 校验三条：①报告日 < run-date（把今天当报告日即 FAIL）；②常规模式（无 --allow-shift）
// 下报告日 == run-date-1；③报告日不得晚于今天。可在 X 日报生成前单独调用，
// 也可对已有日报文件批量体检（--scan：扫 reports/daily 的 frontmatter date）。
//
// 用法:
//   bun tools/2026-10-18-t1-window-guard/t1-window-guard.ts --date YYYY-MM-DD [--run-date YYYY-MM-DD]
//   bun tools/2026-10-18-t1-window-guard/t1-window-guard.ts --scan
// 退出码：0 = 通过；1 = 违反 T-1；2 = 用法异常。
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPORTS = new URL("../../reports/daily", import.meta.url).pathname;

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parse(s: string): Date | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : null;
}
function argOf(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const scan = process.argv.includes("--scan");
const now = new Date();
const today = fmt(now);

if (scan) {
  let bad = 0;
  for (const f of readdirSync(REPORTS).sort()) {
    if (!f.endsWith(".md") || f.includes(today.slice(0, 4)) === false) continue;
    const raw = readFileSync(join(REPORTS, f), "utf8");
    const d = raw.match(/^date:\s*"?(\d{4}-\d{2}-\d{2})/m)?.[1];
    if (!d) continue;
    if (d >= today) {
      bad++;
      console.log(`FAIL ${f}：date=${d} 不早于今天 ${today}（T-1 违规：今天还没过完）`);
    }
  }
  console.log(bad === 0 ? `SCAN OK：reports/daily 无晚于今天 ${today} 的报告` : `SCAN FAIL：${bad} 份`);
  process.exit(bad === 0 ? 0 : 1);
}

const dateStr = argOf("--date") ?? "";
const runStr = argOf("--run-date") ?? today;
const date = parse(dateStr);
const run = parse(runStr);
if (!date || !run) {
  console.error("用法: t1-window-guard.ts --date YYYY-MM-DD [--run-date YYYY-MM-DD] | --scan");
  process.exit(2);
}
const allowShift = process.argv.includes("--allow-shift");
const yest = new Date(run);
yest.setDate(run.getDate() - 1);

const problems: string[] = [];
if (date >= run) problems.push(`报告日 ${dateStr} 晚于（或等于）差分运行日 ${runStr}——把还没过完的一天当成了报告`);
if (!allowShift && dateStr !== fmt(yest)) problems.push(`常规 cron 下报告日应为 run-date 的昨天（${fmt(yest)}），实际 ${dateStr}（确需偏移用 --allow-shift）`);
if (dateStr > today) problems.push(`报告日 ${dateStr} 晚于今天 ${today}——未来的报告不存在`);

if (problems.length) {
  for (const p of problems) console.log(`FAIL ${p}`);
  process.exit(1);
}
console.log(`T1 OK：报告日 ${dateStr}（run-date ${runStr}）归窗正确`);
