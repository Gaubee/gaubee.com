#!/usr/bin/env bun
/**
 * late-star-backfill — 找出「迟到的收藏」并给出回补清单
 *
 * 背景（2026-11-21 实证）：`Veloresearch/kinetic` 与 `MoeForge/moego` 的 starred_at 都是 11-19，
 * 但直到 11-21 的抓取才第一次出现在 changes 里。于是 11-19 的日报写「新增 6（1805）」，
 * 真实是「8（1807）」。这类漂移不是算错，也不是改名，是抓取时序——必须回补前一天的报告，
 * 否则此后每一天的累计都差 2。
 *
 * 判定：starred_at 落在 D，却第一次出现在 changes[D']，且 D' > D+1（正常应出现在次日）。
 *
 * 输出：每个受影响日期 → 迟到条目 → 该日的实际新增/累计 → 需要改哪些文件（报告 + 已发布 event）。
 * 只读，不改文件：回补要在报告正文里加条目、改累计数，还要判断行文，属编辑工作。
 *
 * 用法：
 *   bun tools/2026-11-21-late-star-backfill/late-star-backfill.ts
 *   bun tools/2026-11-21-late-star-backfill/late-star-backfill.ts --days 30
 * 退出码：0 = 已输出（有无迟到都 0）；2 = 数据缺失。只读。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = process.env.GAUBEE_SKILLS_DATA ?? path.join(os.homedir(), ".gaubee-skills", "data");
const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..", "..");
const STARS = path.join(DATA, "sources", "github-stars", "stars.json");
const CHANGES = path.join(DATA, "sources", "github-stars", "changes");
const REPORTS = path.join(SITE, "skills", "gaubee-skills", "reports", "daily");
const EVENTS = path.join(SITE, "src", "content", "events");

const ymd = (d: Date): string => d.toLocaleDateString("sv-SE");
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

interface Repo {
  full_name?: string;
  starred_at?: string;
}

function main(): number {
  const argv = process.argv.slice(2);
  const di = argv.indexOf("--days");
  const days = di >= 0 ? Number(argv[di + 1] ?? 30) : 30;
  for (const p of [STARS, CHANGES, REPORTS]) {
    if (!existsSync(p)) {
      console.error(`缺少：${p}`);
      return 2;
    }
  }

  const since = ymd(addDays(new Date(), -days));
  const files = readdirSync(CHANGES).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  const firstSeen = new Map<string, string>();
  for (const f of files) {
    const day = f.slice(0, 10);
    const j = JSON.parse(readFileSync(path.join(CHANGES, f), "utf8")) as {
      added?: Array<{ full_name?: string }>;
    };
    for (const a of j.added ?? []) if (a.full_name && !firstSeen.has(a.full_name)) firstSeen.set(a.full_name, day);
  }

  const stars = (JSON.parse(readFileSync(STARS, "utf8")) as { repos?: Repo[] }).repos ?? [];
  const lateByDay = new Map<string, string[]>();
  for (const r of stars) {
    if (!r.full_name || !r.starred_at) continue;
    const day = ymd(new Date(r.starred_at));
    if (day < since) continue;
    const seen = firstSeen.get(r.full_name);
    if (!seen) continue;
    const normal = ymd(addDays(new Date(`${day}T12:00:00`), 1));
    if (seen > normal) {
      const arr = lateByDay.get(day) ?? [];
      arr.push(`${r.full_name}（${seen} 才出现）`);
      lateByDay.set(day, arr);
    }
  }

  if (lateByDay.size === 0) {
    console.log(`近 ${days} 天没有迟到的收藏`);
    return 0;
  }

  console.log(`近 ${days} 天发现 ${lateByDay.size} 天有迟到的收藏：\n`);
  for (const [day, list] of [...lateByDay.entries()].sort()) {
    const cumulative = stars.filter((r) => r.starred_at && ymd(new Date(r.starred_at)) <= day).length;
    const newOnDay = stars.filter((r) => r.starred_at && ymd(new Date(r.starred_at)) === day).length;
    console.log(`${day}：迟到 ${list.length} 条，当日实际新增 ${newOnDay}，累计 ${cumulative}`);
    for (const one of list) console.log(`  + ${one}`);

    const report = path.join(REPORTS, `${day}.md`);
    console.log(`  报告：${existsSync(report) ? "在" : "缺"}（reports/daily/${day}.md）`);
    const eventFile = existsSync(EVENTS)
      ? readdirSync(EVENTS).find((f) => f.endsWith(`.github-daily-${day}.md`))
      : undefined;
    console.log(
      `  已发布 event：${eventFile ? `${eventFile}（编号冻结，改内容用同文件原地重写）` : "无"}`,
    );
    console.log(`  回补要点：加条目 + 把「新增 N（总数 M）」改成 ${newOnDay} / ${cumulative}\n`);
  }
  console.log("提示：回补改报告与 event 两处，改完跑 report-facts-check <date> 复核。");
  return 0;
}

process.exit(main());
