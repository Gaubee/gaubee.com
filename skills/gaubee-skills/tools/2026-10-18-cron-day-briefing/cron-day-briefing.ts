// cron-day-briefing.ts — 每日维护开工面板（工坊 2026-10-18 提案 1）
//
// 动机（2026-10-18 实证）：当天 cron 运行把周日误当周一——提前生成了「今天」的
// X 日报（违反 T-1）、写错 GitHub 日报日期、误跑周报覆写上周骨架。根因是开工时
// 没有核对「今天到底几号、星期几、哪些步骤今天该跑」。本工具一次输出：
//   - 今天/YESTERDAY/星期几
//   - 周一专属步骤（周报/staging 清理）今天是否该跑
//   - 最近 3 天各源 changes 文件与已生成日报的对照（缺口一目了然）
// 只读；在管道第 0 步与第 1 步之间跑一次。
//
// 用法: bun tools/2026-10-18-cron-day-briefing/cron-day-briefing.ts
// 退出码：0 = 正常输出（不构成门禁，只作简报）。
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DATA = new URL("../../../../../../../.gaubee-skills/data", import.meta.url).pathname;
const REPORTS = new URL("../../reports/daily", import.meta.url).pathname;

const now = new Date();
const yest = new Date(now);
yest.setDate(now.getDate() - 1);
const fmt = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = fmt(now);
const yesterday = fmt(yest);
const weekday = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][now.getDay()]!;

console.log(`今天：${today}（${weekday}）　YESTERDAY：${yesterday}`);
const mondayOnly: string[] = [];
if (weekday === "周一") mondayOnly.push("周报 --weekly（W=上一完整周）", "staging 周清理（dry-run → execute）");
console.log(mondayOnly.length ? `周一专属步骤：${mondayOnly.join("；")}` : "周一专属步骤：无（今天不跑周报/staging 清理）");
if (weekday !== "周一") {
  console.log("提醒：日报只写 YESTERDAY（T-1），今天（还没过完）绝不出报告。");
}

// 近 3 天对照：changes（抓取日命名）vs 日报（报告日命名）
console.log("\n近 3 天对照（changes@抓取日 → 应有日报@报告日）：");
for (let i = 2; i >= 0; i--) {
  const d = new Date(now);
  d.setDate(now.getDate() - i);
  const day = fmt(d);
  const prev = new Date(d);
  prev.setDate(d.getDate() - 1);
  const prevDay = fmt(prev);
  const changes: string[] = [];
  for (const src of ["github-stars", "github-commits", "github-deps", "x-likes"]) {
    const p = join(DATA, "sources", src, "changes", `${day}.json`);
    if (existsSync(p)) changes.push(src);
  }
  const daily = existsSync(join(REPORTS, `${prevDay}.md`)) ? "GH✓" : "GH缺";
  const xdaily = existsSync(join(REPORTS, `${prevDay}-x.md`)) ? "X✓" : "X缺";
  console.log(`  changes@${day}（${changes.length ? changes.join(",") : "无"}）→ 日报@${prevDay}：${daily} ${xdaily}`);
}
