#!/usr/bin/env bun
/**
 * x-daily-rundate-check — 补跑前先算清 run-date 配不配对
 *
 * 背景（2026-11-14/15 实证）：X 日报的归窗口径是「run-date 的抓取差分归 run-date − 1」。
 * 补跑漏掉的日子时 run-date 会晚于「报告日 + 1」，一次抓取差分覆盖了好几天。旧生成器
 * 会对每个报告日各算一遍整份差分，于是 11-12 与 11-13 的日报 18 条完全相同（11-15 已修）。
 *
 * 修完之后，生成器在不配对时会降级为「只按发布时间窗选条目」——这是对的，但结果可能
 * 只剩很少几条甚至 0 条（0 条会 fail-closed 退出）。所以在按下回车之前，需要先知道：
 *
 *   这个报告日，用这个 run-date，差分到底归不归它？预计能选出几条？
 *
 * 本工具就回答这两件事，不写任何文件，不调用生成器。
 *
 * 用法：
 *   bun tools/2026-11-15-x-daily-rundate-check/x-daily-rundate-check.ts --date 2026-11-14
 *   bun tools/2026-11-15-x-daily-rundate-check/x-daily-rundate-check.ts --from 2026-11-10 --to 2026-11-14
 * 退出码：0 = 配对且预计非空；1 = 不配对或预计 0 条（补跑前需要改方案）；2 = 参数/数据异常。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = process.env.GAUBEE_SKILLS_DATA ?? path.join(os.homedir(), ".gaubee-skills", "data");
const XDIR = path.join(DATA, "sources", "x-likes");
const STORE = path.join(XDIR, "x.json");
const CHANGES = path.join(XDIR, "changes");

interface Tweet {
  id: string;
  kind?: string;
  created_at?: string;
}
interface ChangesFile {
  date?: string;
  added?: Array<{ html_url?: string }>;
}

const ymd = (d: Date): string => d.toLocaleDateString("sv-SE");
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const localDayOf = (iso?: string): string => {
  if (!iso) return "1970-01-01";
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? "1970-01-01" : ymd(t);
};
const statusId = (url: string): string => url.split("/status/")[1]?.split("?")[0] ?? "";

/** 每个 changes 文件里 added 的 status id 集合（用于预览差分规模） */
function loadChanges(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  if (!existsSync(CHANGES)) return out;
  for (const f of readdirSync(CHANGES).sort()) {
    const m = f.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
    if (!m) continue;
    try {
      const j = JSON.parse(readFileSync(path.join(CHANGES, f), "utf8")) as ChangesFile;
      out.set(m[1]!, new Set((j.added ?? []).map((a) => statusId(a.html_url ?? "")).filter(Boolean)));
    } catch {
      out.set(m[1]!, new Set());
    }
  }
  return out;
}

function loadItems(): Record<string, Tweet> {
  if (!existsSync(STORE)) throw new Error(`缺失 ${STORE}`);
  const j = JSON.parse(readFileSync(STORE, "utf8")) as { items?: Record<string, Tweet> };
  return j.items ?? {};
}

interface Verdict {
  date: string;
  runDate: string;
  paired: boolean;
  diffSize: number;
  windowCount: number;
  expected: number;
}

/** 估算该报告日的条目数。必须和生成器的实际口径一致，否则数字会骗人
 *  （2026-11-15 首版把 posted 同时算进差分与时间窗，11-13 估 21 条、实产 16 条）：
 *  - 差分只收 liked/bookmarked（posted 走时间窗，不按差分归属）；
 *  - 时间窗收 posted/reposted 且 created_at 落在该本地日；
 *  - 两者按 id 去重，差额就是既被差分又落在时间窗的条目。 */
function judge(date: string, items: Record<string, Tweet>, changes: Map<string, Set<string>>): Verdict {
  const runDate = ymd(addDays(new Date(`${date}T12:00:00`), 1));
  const paired = changes.has(runDate);
  const diffIds = paired ? changes.get(runDate)! : new Set<string>();
  const diffLiked = new Set<string>();
  for (const id of diffIds) {
    const t = items[id];
    if (t && t.kind !== "posted" && t.kind !== "reposted") diffLiked.add(id);
  }
  const windowIds = new Set(
    Object.values(items)
      .filter((t) => (t.kind === "posted" || t.kind === "reposted") && localDayOf(t.created_at) === date)
      .map((t) => t.id),
  );
  const overlapped = [...diffLiked].filter((id) => windowIds.has(id)).length;
  return {
    date,
    runDate,
    paired,
    diffSize: diffLiked.size,
    windowCount: windowIds.size,
    expected: diffLiked.size + windowIds.size - overlapped,
  };
}

function main(): number {
  const argv = process.argv.slice(2);
  const arg = (f: string): string | undefined => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const from = arg("--from") ?? arg("--date");
  const to = arg("--to") ?? from;
  if (!from || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !to || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    console.error("用法：--date YYYY-MM-DD | --from YYYY-MM-DD --to YYYY-MM-DD");
    return 2;
  }
  for (const p of [XDIR, STORE]) {
    if (!existsSync(p)) {
      console.error(`缺少：${p}`);
      return 2;
    }
  }

  let items: Record<string, Tweet>;
  try {
    items = loadItems();
  } catch (e) {
    console.error(String(e));
    return 2;
  }
  const changes = loadChanges();
  const available = [...changes.keys()].sort();

  const rows: Verdict[] = [];
  for (let d = new Date(`${from}T12:00:00`); ymd(d) <= to; d = addDays(d, 1)) {
    rows.push(judge(ymd(d), items, changes));
  }

  console.log(`run-date 配对检查 ${from} .. ${to}（口径：run-date = 报告日 + 1）`);
  for (const r of rows) {
    const tag = r.paired ? "配对" : "不配对";
    const tail = r.paired
      ? `差分 ${r.diffSize} 条 + 时间窗 ${r.windowCount} 条 → 预计 ${r.expected} 条`
      : `该日无 ${r.runDate} 的差分，只按时间窗选 → 预计 ${r.expected} 条`;
    console.log(`  ${r.date}  次日 ${r.runDate}  ${tag}　${tail}`);
  }

  const bad = rows.filter((r) => !r.paired || r.expected === 0);
  if (bad.length) {
    console.error(`\n需要注意 ${bad.length} 天：`);
    for (const r of bad) {
      if (!r.paired) {
        const nearest = available.filter((d) => d > r.date).slice(0, 1)[0];
        console.error(
          `  - ${r.date} 没有 ${r.runDate} 的 changes（可用差分日期：${nearest ?? "无"}）。` +
            `补跑请直接对着最近的实际抓取日生成，或者先 fetch 再生成。`,
        );
      } else if (r.expected === 0) {
        console.error(`  - ${r.date} 差分与时间窗都是 0 条：生成器会 fail-closed，该日应跳过日报。`);
      }
    }
    return 1;
  }
  console.log("\nRUNDATE OK：区间内每日都有配对差分或时间窗条目");
  return 0;
}

process.exit(main());
