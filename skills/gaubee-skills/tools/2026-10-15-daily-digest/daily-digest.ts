// daily-digest.ts — 日报写作前的跨源事实清单（工坊 2026-10-15 提案 2）
//
// 动机：写日报要在 4 个源的 changes 文件里翻数字（星标几个/提交几条/依赖几项/
// X 几条+kind 分布），每次手拼。本工具一次读齐 changes/<date>.json，输出各源
// 计数与关键明细（新增名单、新技术首见、X kind 分布、富化所需的量级），作为
// 日报「动笔前的事实清单」。与 build-report（周/月/年骨架）互补，不重复。
//
// 口径：changes 文件以「抓取日」命名，报告日 = 抓取日-1（T-1）；输出同时标注
// 两个日期避免误引。只读。
//
// 用法: bun tools/2026-10-15-daily-digest/daily-digest.ts [--date YYYY-MM-DD]
//   --date 为 changes 文件日期（缺省取最新一份）。退出码：0 = 正常；1 = 文件缺失。
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DATA = new URL("../../../../../../../.gaubee-skills/data", import.meta.url).pathname;
const SOURCES = join(DATA, "sources");

interface Changes {
  date: string;
  prev_date?: string;
  added?: Record<string, unknown>[];
  removed?: Record<string, unknown>[];
  changed?: Record<string, unknown>[];
}

function latestChangesDate(): string {
  const dates = new Set<string>();
  for (const src of readdirSync(SOURCES)) {
    const dir = join(SOURCES, src, "changes");
    try {
      for (const f of readdirSync(dir)) if (f.endsWith(".json")) dates.add(f.replace(".json", ""));
    } catch {
      /* 源无 changes 目录则跳过 */
    }
  }
  return [...dates].sort().at(-1) ?? "";
}

const argI = process.argv.indexOf("--date");
const day = argI > 0 && process.argv[argI + 1] ? process.argv[argI + 1]! : latestChangesDate();
if (!day) {
  console.error("daily-digest：找不到任何 changes 文件");
  process.exit(1);
}
// 报告日 = changes 日 - 1（T-1）；用日期分量运算，避免 toISOString 的时区偏移吃掉一天
const [yy, mm, dd] = day.split("-").map(Number);
const reportDayDate = new Date(Date.UTC(yy!, mm! - 1, dd!));
reportDayDate.setUTCDate(reportDayDate.getUTCDate() - 1);
const reportDay = reportDayDate.toISOString().slice(0, 10);
console.log(`事实清单：changes@${day}（报告日 ${reportDay}，T-1）`);

let missing = 0;
for (const src of readdirSync(SOURCES).sort()) {
  const p = join(SOURCES, src, "changes", `${day}.json`);
  let c: Changes;
  try {
    c = JSON.parse(readFileSync(p, "utf8")) as Changes;
  } catch {
    console.log(`\n[${src}] changes/${day}.json 缺失（当日无差分或未抓取）`);
    missing++;
    continue;
  }
  const added = c.added ?? [];
  const removed = c.removed ?? [];
  const changed = c.changed ?? [];
  const parts = [`[${src}] 新增 ${added.length} / 移除 ${removed.length} / 变更 ${changed.length}`];
  if (src === "x-likes" && added.length) {
    const kinds: Record<string, number> = {};
    for (const a of added) {
      // x-likes 的行为类型放在 language 字段（liked/posted/bookmarked/reposted）
      const k = String((a as { language?: string }).language ?? "?");
      kinds[k] = (kinds[k] ?? 0) + 1;
    }
    parts.push(`kind 分布 ${JSON.stringify(kinds)}`);
  }
  if (src === "github-deps") {
    for (const a of added) {
      const d = a as { full_name: string; description?: string };
      parts.push(`首见 ${d.full_name}：${(d.description ?? "").replace(/——新技术采用$/, "")}`);
    }
  }
  console.log(`\n${parts.join("\n  ")}`);
}
process.exit(missing === readdirSync(SOURCES).length ? 1 : 0);
