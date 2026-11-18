#!/usr/bin/env bun
/**
 * taxonomy-coverage-audit — 收藏里有多少还没进策展地图
 *
 * 背景（2026-11-19）：taxonomy 的「未分类」长期在 437 条左右，但没人知道这 437 条
 * 里哪些是最近才收的、哪些是陈年积压。策展是按天增量做的，如果只补当天新增，
 * 存量缺口就永远在那。本工具按 starred_at 倒序列出「最近收到但还没进 taxonomy」的仓库，
 * 让补策展变成「先补最近 30 天」的可执行动作，而不是面对 437 条无从下手。
 *
 * 判定口径：仓库全名出现在 taxonomy.md 的任意位置即视为已策展（链接位或注释都算）。
 *
 * 用法：
 *   bun tools/2026-11-19-taxonomy-coverage-audit/taxonomy-coverage-audit.ts
 *   bun tools/2026-11-19-taxonomy-coverage-audit/taxonomy-coverage-audit.ts --since 2026-10-01 --limit 30
 * 退出码：0 = 已输出；2 = 数据缺失。只读，不改 taxonomy（策展是判断活）。
 */
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = process.env.GAUBEE_SKILLS_DATA ?? path.join(os.homedir(), ".gaubee-skills", "data");
const TAXONOMY = path.join(DATA, "taxonomy.md");
const STARS = path.join(DATA, "sources", "github-stars", "stars.json");

interface Repo {
  full_name?: string;
  description?: string;
  language?: string;
  starred_at?: string;
}

const ymd = (d: Date): string => d.toLocaleDateString("sv-SE");
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function main(): number {
  const argv = process.argv.slice(2);
  const arg = (f: string): string | undefined => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const since = arg("--since") ?? ymd(addDays(new Date(), -30));
  const limit = Number(arg("--limit") ?? 20);
  for (const p of [TAXONOMY, STARS]) {
    if (!existsSync(p)) {
      console.error(`缺少：${p}`);
      return 2;
    }
  }

  const taxonomy = readFileSync(TAXONOMY, "utf8");
  const raw = JSON.parse(readFileSync(STARS, "utf8")) as { repos?: Repo[] };
  const repos = raw.repos ?? [];

  // taxonomy 是**人工精选地图**（约 160 条），不是全量索引——全量在 catalog.md（1799 条）。
  // 所以这里不报「覆盖率百分比」，那个数会误导成「工作没做完」；
  // 只报两件事：地图本身有多少条、最近收藏里漏了哪些。
  const curatedLines = (taxonomy.match(/^- \[[\w.-]+\/[\w.-]+\]\(https:\/\/github\.com\//gm) ?? []).length;
  const curatedNames = new Set(
    [...taxonomy.matchAll(/^- \[([\w.-]+\/[\w.-]+)\]\(https:\/\/github\.com\//gm)].map((m) => m[1]!),
  );

  const missing: Repo[] = [];
  for (const r of repos) {
    if (!r.full_name) continue;
    // 出现在地图任意位置（链接位或注释）都算提到过；未提到且最近收藏的才进缺口
    if (!taxonomy.includes(r.full_name)) missing.push(r);
  }

  // 按 starred_at 倒序，最近的排前面
  missing.sort((a, b) => (b.starred_at ?? "").localeCompare(a.starred_at ?? ""));
  const recent = missing.filter((r) => (r.starred_at ?? "") >= since);

  console.log(`策展地图：${curatedLines} 条条目（${curatedNames.size} 个仓库），全量索引 catalog 共 ${repos.length} 条`);
  console.log(`地图是人工精选，不追求全覆盖；这里只看「最近收藏还没进地图」的部分。`);
  console.log(`${since} 之后收藏的仓库里，有 ${recent.length} 条还没进地图\n`);

  if (recent.length === 0) {
    console.log(`TAXONOMY COVERAGE OK：${since} 之后没有未策展的收藏`);
    return 0;
  }
  console.log(`最近未策展（按收藏时间倒序，取前 ${Math.min(limit, recent.length)} 条）：`);
  for (const r of recent.slice(0, limit)) {
    const d = (r.starred_at ?? "").slice(0, 10);
    const lang = r.language ? ` [${r.language}]` : "";
    console.log(`  ${d}  ${r.full_name}${lang}`);
    console.log(`           ${(r.description ?? "").slice(0, 90)}`);
  }
  if (recent.length > limit) console.log(`  …另 ${recent.length - limit} 条（--limit 调大）`);
  console.log("\n提示：这些是「已收藏但不在策展地图里」，补它们能让检索与分类计数更准。策展归哪个分类需要人判断。");
  return 0;
}

process.exit(main());
