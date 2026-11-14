#!/usr/bin/env bun
/**
 * backfill-plan — 漏跑补给的「可执行命令清单」
 *
 * 背景（2026-11-14）：11-12/11-13 整轮 cron 没跑，人工补的时候最费神的是两件事：
 *   1. 每个源该不该补、按哪个日期命名（commits 按报告日，其余按运行日）；
 *   2. X 日报的 run-date 不能猜——必须是该报告日差分实际所在的那次运行日，
 *      猜错 x-daily-events 会 fail-closed 或写出重复窗。
 *
 * 本工具按区间逐日输出「该跑什么命令」，并且在 X 那一行直接算出正确的 run-date
 * （取该日之后第一个存在 x-likes changes 的日期），把补跑变成照抄。
 *
 * 用法：
 *   bun tools/2026-11-14-backfill-plan/backfill-plan.ts --from 2026-11-12 --to 2026-11-13
 *   bun tools/2026-11-14-backfill-plan/backfill-plan.ts --from 2026-11-12 --to 2026-11-13 --md
 * 退出码：0 = 计划已出（有无缺口都 0）；2 = 参数/路径异常。纯本地只读。
 */
import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = process.env.GAUBEE_SKILLS_DATA ?? path.join(os.homedir(), ".gaubee-skills", "data");
const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..", "..");
const REPORTS = path.join(SITE, "skills", "gaubee-skills", "reports", "daily");
const EVENTS = path.join(SITE, "src", "content", "events");
const XLIKES = path.join(DATA, "sources", "x-likes", "changes");

const ymd = (d: Date): string => d.toLocaleDateString("sv-SE");
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function xChangeDates(): string[] {
  if (!existsSync(XLIKES)) return [];
  return readdirSync(XLIKES)
    .map((f) => f.match(/^(\d{4}-\d{2}-\d{2})\.json$/)?.[1] ?? "")
    .filter(Boolean)
    .sort();
}

/** 该报告日的 X 差分实际落在哪个运行日：取 >= 报告日 的第一个 changes 日期 */
function runDateFor(date: string, available: string[]): string | null {
  return available.find((d) => d >= date) ?? null;
}

function main(): number {
  const argv = process.argv.slice(2);
  const fromIdx = argv.indexOf("--from");
  const toIdx = argv.indexOf("--to");
  const asMd = argv.includes("--md");
  if (fromIdx < 0 || toIdx < 0) {
    console.error("用法：--from YYYY-MM-DD --to YYYY-MM-DD [--md]");
    return 2;
  }
  const from = argv[fromIdx + 1] ?? "";
  const to = argv[toIdx + 1] ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    console.error("--from/--to 需要合法日期且 from <= to");
    return 2;
  }
  for (const p of [REPORTS, EVENTS]) {
    if (!existsSync(p)) {
      console.error(`缺少目录：${p}`);
      return 2;
    }
  }
  const events = readdirSync(EVENTS);
  const hasEvent = (slug: string): boolean => events.some((f) => f.endsWith(`.${slug}.md`));
  const xDates = xChangeDates();

  const lines: string[] = [];
  if (asMd) lines.push(`# 补跑计划 ${from} ~ ${to}`, "");
  else lines.push(`补跑计划 ${from} ~ ${to}`, "");

  for (let d = new Date(`${from}T12:00:00`); ymd(d) <= to; d = addDays(d, 1)) {
    const date = ymd(d);
    const steps: string[] = [];
    if (!existsSync(path.join(DATA, "sources", "github-commits", "changes", `${date}.json`))) {
      steps.push(`bun scripts/github-commits-fetch.ts ${date}`);
    }
    if (!existsSync(path.join(REPORTS, `${date}.md`)) && !hasEvent(`github-daily-${date}`)) {
      steps.push(`（写 reports/daily/${date}.md 后）bun scripts/publish.ts reports/daily/${date}.md --slug github-daily-${date} --title "GitHub 日报：${date}" --tags event,signals,github`);
    }
    const xReport = existsSync(path.join(REPORTS, `${date}-x.md`)) || hasEvent(`x-daily-${date}`);
    if (!xReport) {
      const runDate = runDateFor(date, xDates);
      if (!runDate) {
        steps.push(`# X 日报 ${date}：本地无任何 x-likes changes 覆盖该日，需先跑 x-likes-fetch`);
      } else {
        steps.push(
          `bun scripts/x-daily-events.ts --date ${date} --run-date ${runDate}  →  bun tools/2026-11-04-x-daily-guard/x-daily-guard.ts --date ${date}`,
        );
      }
    }
    const head = steps.length === 0 ? "✓ 已齐全" : `${steps.length} 步`;
    if (asMd) {
      lines.push(`## ${date}（${head}）`, "");
      for (const s of steps) lines.push("```bash", s, "```", "");
    } else {
      lines.push(`${date}（${head}）`);
      for (const s of steps) lines.push(`  ${s}`);
    }
  }
  console.log(lines.join("\n"));
  console.log("\n提示：媒体入档与 Graph 重建全区间只需跑一次；发布逐份单命令执行，不要用 && 串联。");
  return 0;
}

process.exit(main());
