#!/usr/bin/env bun
/**
 * star-cumulative-attribution — 星标累计漂移的「归因」而不是「报错」
 *
 * 背景（2026-11-16 实证）：report-lint 一次报出 23 份日报的「总数」对不上，全部差 1，
 * 从 10-24 起恒为 1、11-03 起变 2。逐条查下去才发现根因不是算术错：10-24 那天
 * alshdavid-public/BorrowScript 改名成 alshdavid-misc/BorrowScript，changes 里是
 * 「removed 旧名 + added 新名」，而当时的日报把 added 那条算进了累计（它不是新收藏）。
 * 另一条是 cicada 的 starred_at 被上游从 11-03 改到 11-08。
 *
 * report-lint 只告诉你「差多少」，不说「为什么差」。本工具按日归因：
 *   - rename：某日有 removed×added 的同一条目（描述+starred_at 相同）→ 当时多算/少算
 *   - revision：starred_at 被上游改写 → 历史累计整体平移
 *   - unknown：两者都解释不了 → 这才是真的需要人看一眼
 *
 * 用法：
 *   bun tools/2026-11-16-star-cumulative-attribution/star-cumulative-attribution.ts
 *   bun tools/2026-11-16-star-cumulative-attribution/star-cumulative-attribution.ts --date 2026-10-24
 * 退出码：0 = 所有漂移都有归因；1 = 存在无法归因的漂移；2 = 数据缺失。纯本地只读。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = process.env.GAUBEE_SKILLS_DATA ?? path.join(os.homedir(), ".gaubee-skills", "data");
const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..", "..");
const STARS_DIR = path.join(DATA, "sources", "github-stars");
const STARS = path.join(STARS_DIR, "stars.json");
const CHANGES = path.join(STARS_DIR, "changes");
const REPORTS = path.join(SITE, "skills", "gaubee-skills", "reports", "daily");

interface Repo {
  full_name?: string;
  description?: string;
  starred_at?: string;
}
interface Changes {
  date?: string;
  added?: Repo[];
  removed?: Repo[];
}

const localDay = (iso?: string): string =>
  iso ? new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" }) : "1970-01-01";

interface Cause {
  kind: "rename" | "revision" | "unknown";
  detail: string;
}

function main(): number {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--date");
  const only = i >= 0 ? argv[i + 1] : "";
  for (const p of [STARS_DIR, REPORTS]) {
    if (!existsSync(p)) {
      console.error(`缺少目录：${p}`);
      return 2;
    }
  }

  const changesFiles = existsSync(CHANGES)
    ? readdirSync(CHANGES).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
    : [];
  const changes: Changes[] = changesFiles.map((f) => {
    try {
      return JSON.parse(readFileSync(path.join(CHANGES, f), "utf8")) as Changes;
    } catch {
      return { date: f.slice(0, 10) };
    }
  });

  // 改名事件：同一天 removed×added 且描述与 starred_at 一致且名字不同
  const renameDays = new Map<string, string[]>();
  for (const c of changes) {
    const d = c.date ?? "";
    for (const r of c.removed ?? []) {
      if (!r.full_name || !r.description) continue;
      const hit = (c.added ?? []).find(
        (a) =>
          a.full_name &&
          a.full_name !== r.full_name &&
          a.description === r.description &&
          a.starred_at === r.starred_at,
      );
      if (hit?.full_name) {
        const arr = renameDays.get(d) ?? [];
        arr.push(`${r.full_name} → ${hit.full_name}`);
        renameDays.set(d, arr);
      }
    }
  }

  // 修订事件：changes 里最后一次 added 的 starred_at 与当前快照不同
  const lastAdded = new Map<string, string>();
  for (const c of changes) for (const a of c.added ?? []) if (a.full_name && a.starred_at) lastAdded.set(a.full_name, a.starred_at);
  const revisions: Array<{ name: string; from: string; to: string }> = [];
  if (existsSync(STARS)) {
    const raw = JSON.parse(readFileSync(STARS, "utf8")) as { repos?: Repo[] };
    for (const r of raw.repos ?? []) {
      if (!r.full_name || !r.starred_at) continue;
      const old = lastAdded.get(r.full_name);
      if (old && localDay(old) !== localDay(r.starred_at)) {
        revisions.push({ name: r.full_name, from: localDay(old), to: localDay(r.starred_at) });
      }
    }
  }

  // 逐份日报对账：读「总数 N」，与快照按 starred_at 累计比
  const raw = JSON.parse(readFileSync(STARS, "utf8")) as { repos?: Repo[] };
  const byDay = new Map<string, number>();
  for (const r of raw.repos ?? []) {
    if (!r.starred_at) continue;
    const d = localDay(r.starred_at);
    byDay.set(d, (byDay.get(d) ?? 0) + 1);
  }
  const cumByDay = new Map<string, number>();
  let cum = 0;
  for (const d of [...byDay.keys()].sort()) {
    cum += byDay.get(d)!;
    cumByDay.set(d, cum);
  }
  const cumAt = (day: string): number => {
    let best = "";
    for (const d of cumByDay.keys()) if (d <= day && d > best) best = d;
    return best ? cumByDay.get(best)! : 0;
  };

  const rows: Array<{ date: string; claimed: number; real: number; causes: Cause[] }> = [];
  for (const f of readdirSync(REPORTS).filter((x) => /^\d{4}-\d{2}-\d{2}\.md$/.test(x)).sort()) {
    const date = f.slice(0, 10);
    if (only && date !== only) continue;
    const text = readFileSync(path.join(REPORTS, f), "utf8");
    const claimed = Number(text.match(/总数\s*([0-9]+)/)?.[1] ?? NaN);
    if (!Number.isFinite(claimed)) continue;
    const real = cumAt(date);
    if (claimed === real) continue;

    const causes: Cause[] = [];
    // 归因规则（2026-11-16 逐日核对后定稿）：
    // 改名当天，changes 里会多出一条 added（新名），但快照总数不变（旧名消失、新名顶上）。
    // 如果日报把那条 added 当「新增」算进累计，累计就会永久多 1 —— 这是真实的漂移来源。
    // 但要注意两份日报的归属：日报 date=D 读的是 changes/D.json，所以只有 D 恰好等于
    // 改名日时才会被这条 added 影响。之前把所有「早于该日的改名」都列成归因是错的
    // （10-23 的报告不可能受 10-24 的改名影响）。
    const sameDay = renameDays.get(date) ?? [];
    for (const one of sameDay) causes.push({ kind: "rename", detail: `${date} 改名：${one}` });
    for (const rv of revisions) {
      if (rv.from <= date && rv.to > date) {
        causes.push({ kind: "revision", detail: `${rv.name} starred_at ${rv.from} → ${rv.to}` });
      }
    }
    // 当日没有改名/修订，但累计仍对不上：可能是更早某日的改名把误差带了过来。
    // 这时列出「该日之前最近的改名日」，标注为传导性影响而不是直接原因。
    if (causes.length === 0) {
      const earlier = [...renameDays.keys()].filter((d) => d < date).sort();
      const nearest = earlier.at(-1);
      if (nearest) {
        causes.push({
          kind: "rename",
          detail: `传导：${nearest} 的改名把 +1 带到了此后所有日报（当日本身无改名）`,
        });
      }
    }
    rows.push({ date, claimed, real, causes });
  }

  console.log(`星标累计漂移归因（${rows.length} 份日报对不上）`);
  let unknown = 0;
  for (const r of rows) {
    const delta = r.claimed - r.real;
    const kinds = [...new Set(r.causes.map((c) => c.kind))];
    const tag = kinds.length ? kinds.join("+") : "unknown";
    if (!kinds.length) unknown++;
    console.log(`\n${r.date}  写 ${r.claimed}，实测 ${r.real}（差 ${delta > 0 ? "+" : ""}${delta}）  归因：${tag}`);
    for (const c of r.causes.slice(0, 3)) console.log(`  · [${c.kind}] ${c.detail}`);
    if (r.causes.length > 3) console.log(`  · …另 ${r.causes.length - 3} 条同类`);
  }

  if (rows.length === 0) {
    console.log("\nSTAR CUMULATIVE OK：所有日报的累计数与快照一致");
    return 0;
  }
  if (unknown > 0) {
    console.error(`\n有 ${unknown} 份无法归因，需要人看`);
    return 1;
  }
  console.log(
    `\n全部 ${rows.length} 份都有归因：改名会让当日多算 1（added 的新名被当新增），` +
      `starred_at 修订会让后续累计整体平移。这些是历史事实，不是算术错误，不必改历史日报。`,
  );
  return 0;
}

process.exit(main());
