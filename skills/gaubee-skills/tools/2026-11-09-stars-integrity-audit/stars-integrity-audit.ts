#!/usr/bin/env bun
/**
 * stars-integrity-audit — 星标数据完整性审计（改名识别 + starred_at 静默修订）
 *
 * 背景（2026-11-08/09 实证）：
 * 1. 仓库换 owner（calesthio/OpenMontage → OpenMontageInc/OpenMontage）在 diff 里表现为
 *    「移除 1 + 新增 1」，taxonomy 不会自动跟着改，靠人眼发现。
 * 2. 某仓库的 starred_at 被上游静默改写（wquguru/cicada 从 11-03 变成 11-08），changes
 *    的 changed[] 不记录这个字段，历史日报里的「累计总数」因此对不上——report-lint 会报
 *    漂移，但看不出是数据修订还是算术错误。
 *
 * 做法：
 * - 改名：在最新 changes 里找 removed×added 的「描述 + starred_at 相同、名字不同」配对，
 *   并检查 taxonomy 是否还引用旧名字。
 * - 静默修订：把 stars.json 的 starred_at 与 changes 历史里最后一次 added 的 starred_at
 *   对比，列出不一致（历史累计会随之平移）。
 *
 * 用法：bun tools/2026-11-09-stars-integrity-audit/stars-integrity-audit.ts [--strict] [--json]
 * 退出码：0 = 报告完成（--strict 且有「待处理」项时 1）；2 = 数据缺失。纯本地只读。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = process.env.GAUBEE_SKILLS_DATA ?? path.join(os.homedir(), ".gaubee-skills", "data");
const STARS_DIR = path.join(DATA, "sources", "github-stars");
const STARS = path.join(STARS_DIR, "stars.json");
const CHANGES = path.join(STARS_DIR, "changes");
const TAXONOMY = path.join(DATA, "taxonomy.md");

interface RepoEntry {
  full_name: string;
  description?: string;
  starred_at?: string;
  html_url?: string;
}
interface ChangesFile {
  date?: string;
  added?: RepoEntry[];
  removed?: RepoEntry[];
}

interface RenamePair {
  from: string;
  to: string;
  starred_at: string;
  taxonomy: "updated" | "stale" | "absent";
}

interface Revision {
  full_name: string;
  recorded: string;
  current: string;
  last_added_on: string;
}

function main(): number {
  const argv = process.argv.slice(2);
  const strict = argv.includes("--strict");
  const asJson = argv.includes("--json");
  for (const p of [STARS, CHANGES, TAXONOMY]) {
    if (!existsSync(p)) {
      console.error(`缺少输入：${p}`);
      return 2;
    }
  }
  const stars = JSON.parse(readFileSync(STARS, "utf8")) as { repos: RepoEntry[] };
  const taxonomy = readFileSync(TAXONOMY, "utf8");
  const files = readdirSync(CHANGES)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  const latest = files.at(-1);
  if (!latest) {
    console.error(`changes 目录为空：${CHANGES}`);
    return 2;
  }
  const latestChanges = JSON.parse(readFileSync(path.join(CHANGES, latest), "utf8")) as ChangesFile;

  // ---- 1) 改名识别 ----
  const pairs: RenamePair[] = [];
  for (const oldRepo of latestChanges.removed ?? []) {
    const match = (latestChanges.added ?? []).find(
      (a) =>
        a.full_name !== oldRepo.full_name &&
        (a.description ?? "") === (oldRepo.description ?? "") &&
        (a.starred_at ?? "") === (oldRepo.starred_at ?? ""),
    );
    if (!match) continue;
    const hasNew = taxonomy.includes(match.full_name);
    const hasOld = taxonomy.includes(oldRepo.full_name);
    pairs.push({
      from: oldRepo.full_name,
      to: match.full_name,
      starred_at: oldRepo.starred_at ?? "?",
      taxonomy: hasNew && !hasOld ? "updated" : hasOld ? "stale" : "absent",
    });
  }

  // ---- 2) starred_at 静默修订 ----
  const lastAdded = new Map<string, { starred_at: string; date: string }>();
  for (const f of files) {
    const c = JSON.parse(readFileSync(path.join(CHANGES, f), "utf8")) as ChangesFile;
    for (const a of c.added ?? []) {
      lastAdded.set(a.full_name, { starred_at: a.starred_at ?? "", date: c.date ?? f.slice(0, 10) });
    }
  }
  const revisions: Revision[] = [];
  for (const repo of stars.repos) {
    const rec = lastAdded.get(repo.full_name);
    if (!rec || !rec.starred_at || !repo.starred_at) continue;
    if (rec.starred_at !== repo.starred_at) {
      revisions.push({
        full_name: repo.full_name,
        recorded: rec.starred_at,
        current: repo.starred_at,
        last_added_on: rec.date,
      });
    }
  }

  if (asJson) {
    console.log(JSON.stringify({ changes: latest, renames: pairs, revisions }, null, 2));
    return strict && (pairs.some((p) => p.taxonomy !== "updated") || revisions.length > 0) ? 1 : 0;
  }

  console.log(`最新 changes：${latest}｜stars.json ${stars.repos.length} 条`);
  console.log(
    pairs.length === 0
      ? "改名：无"
      : `改名：${pairs.length} 对`,
  );
  for (const p of pairs) {
    const label =
      p.taxonomy === "updated" ? "taxonomy 已更新" : p.taxonomy === "stale" ? "✗ taxonomy 仍引用旧名" : "△ taxonomy 未收录新名";
    console.log(`  ${p.from} → ${p.to}（starred_at ${p.starred_at}）：${label}`);
  }
  console.log(
    revisions.length === 0
      ? "starred_at 静默修订：无"
      : `starred_at 静默修订：${revisions.length} 条（历史累计会平移，report-lint 的漂移先看这里）`,
  );
  for (const r of revisions.slice(0, 10)) {
    console.log(`  ${r.full_name}：${r.recorded} → ${r.current}（上次新增记录 ${r.last_added_on}）`);
  }
  if (revisions.length > 10) console.log(`  … 共 ${revisions.length} 条`);
  console.log(
    "\n说明：改名项要人工更新 taxonomy 与历史引用；静默修订是上游数据变化，不属算术错误。",
  );
  const needsAction = pairs.some((p) => p.taxonomy !== "updated") || revisions.length > 0;
  return strict && needsAction ? 1 : 0;
}

process.exit(main());
