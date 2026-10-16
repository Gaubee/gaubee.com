// deps-jitter-report.ts — deps changes 重复抖动仓识别（工坊 2026-10-16 提案 2）
//
// 动机：changes 的 changed[] 连续多日点名同三个仓库（PlusMeta-Admin /
// net-mesh-simulator / jSouper），deps-digest 每次都判定「快照无版本级变化」——
// bumpedCount 的口径把清单抖动也计成变更，日报与周报的「依赖变更 N」被噪声稀释。
//
// 做什么：回看最近 N 天的 deps changes，对每个被 changed[] 点名的仓库做相邻快照
// 对比（同 deps-digest 口径，section:name 键），统计「点名次数 vs 真实版本变化
// 次数」；点名≥2 次且真实变化 0 次的仓库列为抖动源，输出噪声清单与占比，
// 供日报/周报口径引用（「依赖变更 N（其中抖动 M）」）。只读。
//
// 用法: bun tools/2026-10-16-deps-jitter-report/deps-jitter-report.ts [--days 7]
// 退出码：0 = 正常输出；1 = 数据不足。
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DATA = new URL("../../../../../../../.gaubee-skills/data", import.meta.url).pathname;
const SRC = join(DATA, "sources/github-deps");

function argDays(): number {
  const i = process.argv.indexOf("--days");
  const v = i > 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isInteger(v) && v > 0 ? v : 7;
}
const days = argDays();

const allDays = readdirSync(join(SRC, "changes")).filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", "")).sort();
const window = allDays.slice(-days);
if (window.length < 2) {
  console.error(`deps-jitter-report：窗口内 changes 不足（${window.length} 天）`);
  process.exit(1);
}

type Dep = { name: string; version: string; section: string };
function snapshot(day: string): Map<string, Map<string, string>> {
  const j = JSON.parse(readFileSync(join(SRC, "history", `${day}.json`), "utf8")) as {
    repos: { repo: string; deps: Dep[] }[];
  };
  const m = new Map<string, Map<string, string>>();
  for (const r of j.repos) {
    m.set(r.repo, new Map(r.deps.map((d) => [`${d.section}:${d.name}`, d.version])));
  }
  return m;
}

const stats = new Map<string, { named: number; real: number }>();
for (const day of window) {
  let changes: { changed?: { full_name: string }[]; prev_date?: string };
  try {
    changes = JSON.parse(readFileSync(join(SRC, "changes", `${day}.json`), "utf8"));
  } catch {
    continue;
  }
  const prev = changes.prev_date;
  if (!prev) continue;
  let prevSnap: Map<string, Map<string, string>>;
  let currSnap: Map<string, Map<string, string>>;
  try {
    prevSnap = snapshot(prev);
    currSnap = snapshot(day);
  } catch {
    continue; // history 快照缺失的天跳过
  }
  for (const c of changes.changed ?? []) {
    const repo = c.full_name;
    const s = stats.get(repo) ?? { named: 0, real: 0 };
    s.named += 1;
    const before = prevSnap.get(repo);
    const after = currSnap.get(repo);
    if (before && after) {
      const keys = new Set([...before.keys(), ...after.keys()]);
      for (const k of keys) if (before.get(k) !== after.get(k)) s.real += 1;
    }
    stats.set(repo, s);
  }
}

const rows = [...stats.entries()].sort((a, b) => b[1].named - a[1].named);
let jitter = 0;
console.log(`窗口：最近 ${window.length} 个 changes 日（${window[0]} ~ ${window[window.length - 1]}）`);
for (const [repo, s] of rows) {
  const isJitter = s.named >= 2 && s.real === 0;
  if (isJitter) jitter++;
  console.log(`${isJitter ? "JITTER" : "  ok  "} ${repo}：点名 ${s.named} 次 / 版本级变化 ${s.real} 次`);
}
const named = rows.reduce((n, [, s]) => n + s.named, 0);
console.log(`\n结论：点名 ${named} 次中抖动源 ${jitter} 个；日报口径可写「依赖变更 N（其中 M 为重复抖动）」`);
