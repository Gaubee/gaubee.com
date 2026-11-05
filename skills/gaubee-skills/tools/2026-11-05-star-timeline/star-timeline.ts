#!/usr/bin/env bun
/**
 * star-timeline — 星标时间线（每日新增与累计，权威口径）
 *
 * 背景（2026-11-04 实证）：补跑多日日报时，「新增 N（总数 M）」里的 M 靠心算极易
 * 差一（当天把 1731/1739/1740 都写少了一位）。stars.json 里每条都有 starred_at，
 * 按本地日聚合即得精确的每日新增与累计——本工具把这个口径固化成一条命令。
 *
 * 用法：
 *   bun tools/2026-11-05-star-timeline/star-timeline.ts [--from 2026-10-31] [--to 2026-11-05]
 *   bun tools/2026-11-05-star-timeline/star-timeline.ts --days 14     # 最近 14 天
 * 退出码：0 = 正常；1 = 数据缺失。纯本地只读、零网络。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const DATA = process.env.GAUBEE_SKILLS_DATA ?? path.join(os.homedir(), ".gaubee-skills", "data");
const STARS = path.join(DATA, "sources", "github-stars", "stars.json");

function localDay(iso: string): string {
  return new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
}

function main(): number {
  if (!existsSync(STARS)) {
    console.error(`stars.json 缺失：${STARS}`);
    return 1;
  }
  const argv = process.argv.slice(2);
  const arg = (flag: string, dflt = "") => {
    const i = argv.indexOf(flag);
    return i >= 0 ? (argv[i + 1] ?? dflt) : dflt;
  };
  const raw = JSON.parse(readFileSync(STARS, "utf8")) as {
    repos: { full_name?: string; starred_at?: string }[];
  };
  const byDay = new Map<string, string[]>();
  const undated: string[] = [];
  for (const r of raw.repos) {
    const name = r.full_name ?? "(unknown)";
    const ts = r.starred_at;
    if (!ts) {
      undated.push(name);
      continue;
    }
    const d = localDay(ts);
    const list = byDay.get(d) ?? [];
    list.push(name);
    byDay.set(d, list);
  }
  const days = [...byDay.keys()].sort();

  const today = localDay(new Date().toISOString());
  const daysN = Number(arg("--days", "0")) || 0;
  let from = arg("--from");
  let to = arg("--to", daysN ? today : days[days.length - 1] ?? today);
  if (daysN > 0) {
    const t = new Date(`${to}T00:00:00+08:00`).getTime() - (daysN - 1) * 24 * 3600_000;
    from = localDay(new Date(t).toISOString());
  }
  if (!from) from = days[Math.max(0, days.length - 14)] ?? today;

  // 累计基线：早于 from 的条数
  let cum = raw.repos.filter((r) => r.starred_at && localDay(r.starred_at) < from).length;
  console.log(`星标时间线（${from} ~ ${to}，全集 ${raw.repos.length} 条${undated.length ? `，其中 ${undated.length} 条无 starred_at` : ""}）`);
  let t = new Date(`${from}T00:00:00+08:00`).getTime();
  const end = new Date(`${to}T00:00:00+08:00`).getTime();
  let windowAdded = 0;
  while (t <= end) {
    const d = localDay(new Date(t).toISOString());
    const added = byDay.get(d) ?? [];
    cum += added.length;
    windowAdded += added.length;
    const mark = added.length ? "+" : " ";
    console.log(`  ${d}  ${mark}${added.length}  累计 ${cum}${added.length ? `  ${added.join("、")}` : ""}`);
    t += 24 * 3600_000;
  }
  console.log(`区间新增 ${windowAdded}，期末累计 ${cum}`);
  return 0;
}

process.exit(main());
