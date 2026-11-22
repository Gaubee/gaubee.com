#!/usr/bin/env bun
/**
 * weekly-theme-signals — 周报分析动笔前的「主题信号」清单
 *
 * 背景（2026-11-23）：周报的「分析」段要写主题聚类、与 profile 的印证/漂移、工具与裁决进展。
 * 现有的 weekly-digest 给的是**按仓库的提交清单**，人还得自己归纳主线：哪些库是同一件事、
 * 哪条线这周最重、哪些变化其实是改名抖动。23 个日出报告之后这步很费神。
 *
 * 本工具把归纳所需的信号抽出来：
 *   1. 提交主线：按 conventional scope（`feat(jiudian)` / `fix(triggers)` …）聚合，看哪条线最重
 *   2. 星标主题：把本周新增按 taxonomy 分类聚合，看兴趣往哪偏
 *   3. 抖动识别：改名对数与元数据变化占比，提醒「这些不是新信号」
 *   4. 工具工坊进展：本周 REGISTRY 新增了哪些提案
 *
 * 只读，不写报告。
 *
 * 用法：
 *   bun tools/2026-11-23-weekly-theme-signals/weekly-theme-signals.ts --from 2026-11-16 --to 2026-11-22
 * 退出码：0 = 已输出；2 = 参数/数据缺失。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = process.env.GAUBEE_SKILLS_DATA ?? path.join(os.homedir(), ".gaubee-skills", "data");
const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..", "..");
const SKILL = path.join(SITE, "skills", "gaubee-skills");

interface Commit {
  message: string;
}
interface Push {
  repo: string;
  count: number;
  commits: Commit[];
}

function readJson<T>(file: string): T | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

const ymd = (d: Date): string => d.toLocaleDateString("sv-SE");
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function main(): number {
  const argv = process.argv.slice(2);
  const arg = (f: string, d: string): string => {
    const i = argv.indexOf(f);
    return i >= 0 ? (argv[i + 1] ?? d) : d;
  };
  const from = arg("--from", ymd(addDays(new Date(), -7)));
  const to = arg("--to", ymd(addDays(new Date(), -1)));
  for (const p of [DATA]) {
    if (!existsSync(p)) {
      console.error(`缺少：${p}`);
      return 2;
    }
  }

  console.log(`weekly-theme-signals：${from} ~ ${to}`);

  // 1) 提交主线：按 scope 聚合
  const byScope = new Map<string, { count: number; repos: Set<string>; samples: string[] }>();
  let totalCommits = 0;
  const commitDir = path.join(DATA, "sources", "github-commits", "history");
  for (let d = new Date(`${from}T12:00:00`); ymd(d) <= to; d = addDays(d, 1)) {
    const j = readJson<{ totalCommits?: number; pushes?: Push[] }>(path.join(commitDir, `${ymd(d)}.json`));
    if (!j?.pushes) continue;
    totalCommits += j.totalCommits ?? 0;
    for (const p of j.pushes) {
      for (const c of p.commits ?? []) {
        const first = c.message.split("\n")[0] ?? "";
        const m = first.match(/^(\w+)(?:\(([^)]+)\))?[:：]/);
        const key = m ? `${m[1]}${m[2] ? `(${m[2]})` : ""}` : "其它";
        const e = byScope.get(key) ?? { count: 0, repos: new Set<string>(), samples: [] };
        e.count++;
        e.repos.add(p.repo);
        if (e.samples.length < 2) e.samples.push(first.slice(0, 80));
        byScope.set(key, e);
      }
    }
  }
  console.log(`\n[提交主线] 共 ${totalCommits} 条，按 scope 聚合（前 8）：`);
  for (const [k, v] of [...byScope.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 8)) {
    console.log(`  ${k}：${v.count} 条（${[...v.repos].map((r) => r.split("/")[1]).join("、")}）`);
    for (const s of v.samples) console.log(`      · ${s}`);
  }

  // 2) 星标主题：本周新增按 taxonomy 分类
  const stars = readJson<{ repos?: Array<{ full_name?: string; starred_at?: string; description?: string }> }>(
    path.join(DATA, "sources", "github-stars", "stars.json"),
  );
  const taxonomy = existsSync(path.join(DATA, "taxonomy.md")) ? readFileSync(path.join(DATA, "taxonomy.md"), "utf8") : "";
  if (stars?.repos) {
    const newOnes = stars.repos.filter((r) => r.starred_at && ymd(new Date(r.starred_at)) >= from && ymd(new Date(r.starred_at)) <= to);
    console.log(`\n[星标主题] 本周新增 ${newOnes.length} 个，按策展分类：`);
    const sections = new Map<string, string[]>();
    let section = "未进地图";
    for (const line of taxonomy.split("\n")) {
      const h = line.match(/^###\s+(.+?)（/);
      if (h) section = h[1]!;
      for (const r of newOnes) if (r.full_name && line.includes(`[${r.full_name}]`)) {
        const arr = sections.get(section) ?? [];
        arr.push(r.full_name);
        sections.set(section, arr);
      }
    }
    for (const [s, list] of [...sections.entries()].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  ${s} ${list.length}：${list.join("、")}`);
    }
  }

  // 3) 抖动识别：改名对数 + 元数据变化占比
  let renames = 0;
  let metaChanges = 0;
  const changeDir = path.join(DATA, "sources", "github-stars", "changes");
  for (let d = new Date(`${from}T12:00:00`); ymd(d) <= to; d = addDays(d, 1)) {
    const j = readJson<{
      added?: Array<{ description?: string; starred_at?: string; full_name?: string }>;
      removed?: Array<{ description?: string; starred_at?: string; full_name?: string }>;
      changed?: unknown[];
    }>(path.join(changeDir, `${ymd(d)}.json`));
    if (!j) continue;
    metaChanges += (j.changed ?? []).length;
    for (const r of j.removed ?? []) {
      if (!r.description) continue;
      if ((j.added ?? []).some((a) => a.description === r.description && a.starred_at === r.starred_at && a.full_name !== r.full_name)) {
        renames++;
      }
    }
  }
  console.log(`\n[抖动识别] 改名 ${renames} 对，元数据变化 ${metaChanges} 项（这些不是新信号）`);

  // 4) 工坊进展
  const registry = existsSync(path.join(SKILL, "tools", "REGISTRY.md"))
    ? readFileSync(path.join(SKILL, "tools", "REGISTRY.md"), "utf8")
    : "";
  const rows = registry.split("\n").filter((l) => l.startsWith("| 2"));
  const inWeek = rows.filter((l) => {
    const m = l.match(/^\|\s*(\d{4}-\d{2}-\d{2})/);
    return m && m[1]! >= from && m[1]! <= to;
  });
  console.log(`\n[工坊进展] 本周新增提案 ${inWeek.length} 个：`);
  for (const l of inWeek) {
    const cells = l.split("|").map((c) => c.trim());
    console.log(`  ${cells[1]} ${cells[2]}（${cells[5]}）`);
  }
  const statusCount = new Map<string, number>();
  for (const l of rows) {
    const st = l.split("|").map((c) => c.trim())[5] ?? "?";
    statusCount.set(st, (statusCount.get(st) ?? 0) + 1);
  }
  console.log(`  全簿状态：${[...statusCount.entries()].map(([k, v]) => `${k} ${v}`).join(" / ")}`);
  return 0;
}

process.exit(main());
