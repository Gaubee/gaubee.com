#!/usr/bin/env bun
/**
 * rename-impact-audit — 星标仓库改名后「已发布内容还引用旧名」的清单
 *
 * 背景（2026-11-15 实证）：11-14 有 3 个仓库改名
 * （codepawl/67.js → crucible、CopilotKit/openmuse → openfuse、
 * neondatabase/electric-pglite → electric-sql/electric-pglite）。
 * stars-integrity-audit 只报告「taxonomy 是否还引用旧名」，改完 taxonomy 就结束了；
 * 但旧名还留在 5 份历史日报、2 份周/月报和 5 个已发布 event 里。这些链接靠 GitHub
 * 301 还能跳，但正文写的名字与仓库现状不符，读者点进去看到的是另一个名字。
 *
 * 本工具把「改名 → 影响面」补完：从 changes 历史里认改名（描述+starred_at 相同、
 * 名字不同），然后扫 taxonomy / reports / 已发布 events，按文件列出旧名残留，
 * 并区分「可安全改写」（历史报告正文）与「冻结不改」（已发布 event 的编号文件）。
 *
 * 用法：
 *   bun tools/2026-11-15-rename-impact-audit/rename-impact-audit.ts
 *   bun tools/2026-11-15-rename-impact-audit/rename-impact-audit.ts --since 2026-11-01
 *   bun tools/2026-11-15-rename-impact-audit/rename-impact-audit.ts --json
 * 退出码：0 = 列出完成（有无残留都 0，它是清单工具不是门禁）；2 = 数据缺失。纯本地只读。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = process.env.GAUBEE_SKILLS_DATA ?? path.join(os.homedir(), ".gaubee-skills", "data");
const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..", "..");
const STARSDIR = path.join(DATA, "sources", "github-stars");
const STARS = path.join(STARSDIR, "stars.json");
const STARS_CHANGES = path.join(STARSDIR, "changes");
const TAXONOMY = path.join(DATA, "taxonomy.md");
const REPORTS = path.join(SITE, "skills", "gaubee-skills", "reports");
const EVENTS = path.join(SITE, "src", "content", "events");

interface RepoEntry {
  full_name?: string;
  description?: string;
  starred_at?: string;
}
interface ChangesFile {
  date?: string;
  added?: RepoEntry[];
  removed?: RepoEntry[];
}
interface Rename {
  from: string;
  to: string;
  starred_at: string;
  seenOn: string;
}
interface Hit {
  file: string;
  kind: "taxonomy" | "report" | "event";
  lines: number;
  frozen: boolean;
}

function readChanges(): ChangesFile[] {
  if (!existsSync(STARS_CHANGES)) return [];
  return readdirSync(STARS_CHANGES)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      try {
        return JSON.parse(readFileSync(path.join(STARS_CHANGES, f), "utf8")) as ChangesFile;
      } catch {
        return { date: f.replace(/\.json$/, "") };
      }
    });
}

/** 改名识别：同一天里 removed×added，描述相同且 starred_at 相同但 full_name 不同。
 *  两条收紧规则（2026-11-15 首跑实证）：
 *  1. 描述为空不配对——空描述会让两个无关仓库也「相同」，那是误判源；
 *  2. 目标名必须仍在当前 stars.json 里——否则是「删了一个、另加一个」，不是改名。
 *     反例：11-12 的 electric-sql/electric → neondatabase/electric 在 11-15 又被删掉，
 *     若不加这条会产出方向可疑的配对。 */
function findRenames(files: ChangesFile[], since: string, current: Set<string>): Rename[] {
  const out: Rename[] = [];
  for (const f of files) {
    const date = f.date ?? "";
    if (since && date < since) continue;
    const removed = f.removed ?? [];
    const added = f.added ?? [];
    for (const r of removed) {
      if (!r.full_name || !r.description) continue;
      if (current.has(r.full_name)) continue; // 旧名还在收藏里 = 没删，不是改名
      const hit = added.find(
        (a) =>
          a.full_name &&
          a.full_name !== r.full_name &&
          current.has(a.full_name) &&
          a.description === r.description &&
          a.starred_at === r.starred_at,
      );
      if (hit?.full_name) {
        out.push({ from: r.full_name, to: hit.full_name, starred_at: hit.starred_at ?? "", seenOn: date });
      }
    }
  }
  return out;
}

/** 当前收藏里的仓库全名集合（改名判定的「目标仍在册」依据） */
function currentStarNames(): Set<string> {
  const names = new Set<string>();
  if (!existsSync(STARS)) return names;
  try {
    const j = JSON.parse(readFileSync(STARS, "utf8")) as { repos?: Array<{ full_name?: string }> };
    for (const r of j.repos ?? []) if (r.full_name) names.add(r.full_name);
  } catch {
    // 读不到就当没有任何在册仓库：结果是「不改名」而不是误报改名，方向安全
  }
  return names;
}

function scanFile(file: string, needle: string): number {
  try {
    const text = readFileSync(file, "utf8");
    // 边界匹配：旧名后面不能再跟仓库名的合法字符。否则 electric-sql/electric 会把
    // electric-sql/electric-pglite 也算成命中（2026-11-15 首跑误报）。
    const re = new RegExp(`${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w.-])`, "g");
    return (text.match(re) ?? []).length;
  } catch {
    return 0;
  }
}

function walk(dir: string, filter: (f: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(p, filter));
    else if (filter(ent.name)) out.push(p);
  }
  return out;
}

function locate(from: string): Hit[] {
  const hits: Hit[] = [];
  const push = (file: string, kind: Hit["kind"], frozen: boolean): void => {
    const n = scanFile(file, from);
    if (n > 0) hits.push({ file: path.relative(SITE, file), kind, lines: n, frozen });
  };
  push(TAXONOMY, "taxonomy", false);
  for (const f of walk(REPORTS, (n) => n.endsWith(".md"))) push(f, "report", false);
  for (const f of walk(EVENTS, (n) => n.endsWith(".md"))) push(f, "event", true);
  return hits;
}

function main(): number {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--since");
  const since = i >= 0 ? (argv[i + 1] ?? "") : "";
  const asJson = argv.includes("--json");
  for (const p of [DATA, REPORTS, EVENTS]) {
    if (!existsSync(p)) {
      console.error(`缺少目录：${p}`);
      return 2;
    }
  }

  const renames = findRenames(readChanges(), since, currentStarNames());
  const result = renames.map((r) => ({ ...r, hits: locate(r.from) }));

  if (asJson) {
    console.log(JSON.stringify({ renames: result }, null, 2));
    return 0;
  }

  console.log(`改名影响面${since ? `（since ${since}）` : ""}：${result.length} 对`);
  let residue = 0;
  for (const r of result) {
    const stale = r.hits.filter((h) => h.kind === "taxonomy");
    const reports = r.hits.filter((h) => h.kind === "report");
    const events = r.hits.filter((h) => h.kind === "event");
    console.log(`\n${r.from} → ${r.to}（starred_at ${r.starred_at || "?"}，${r.seenOn} 认名）`);
    if (stale.length === 0 && reports.length === 0 && events.length === 0) {
      console.log("  ✓ 无残留引用");
      continue;
    }
    if (stale.length) console.log(`  ✗ taxonomy 仍引用旧名（${stale.length} 处，应改）`);
    for (const h of reports) console.log(`  · 历史报告 ${h.file}（${h.lines} 处，可改写）`);
    for (const h of events) console.log(`  · 已发布 event ${h.file}（${h.lines} 处，编号冻结，只能另发勘误）`);
    residue += r.hits.length;
  }
  console.log(
    residue
      ? `\n合计 ${residue} 个文件仍引用旧名。taxonomy 必改；历史报告建议改（链接靠 301 能跳但名字不符）；已发布 event 编号不可变。`
      : "\nRENAME IMPACT OK：所有旧名已无引用",
  );
  return 0;
}

process.exit(main());
