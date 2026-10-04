#!/usr/bin/env bun
/**
 * stale-check.ts — 收藏保鲜检查（gaubee-skills 工具工坊提案 #2，2026-10-03）
 *
 * 文件意图（正交意图清单）：
 * - [2026-10-03] 原始需求（kzf）：推荐工具时应避开已死项目；收藏也需要定期修剪。
 * - 1. 扫描 stars.json，列出 archived 与 pushed_at 距今超过 N 年（默认 3）的仓库
 * - 2. 按分类小计，帮助判断哪类收藏老化最重
 *
 * 用法：bun stale-check.ts [--years 3] [--category <分类子串>] [--limit 20]
 */
import path from "node:path";
import { sourceDir } from "../../scripts/lib.ts";

import { categorize } from "../../scripts/github-stars-categorize.ts";

interface StarRepo {
  full_name: string;
  html_url: string;
  description: string;
  language: string;
  stars: number;
  pushed_at: string;
  archived: boolean;
}

interface Query {
  years: number;
  category: string;
  limit: number;
}

function parseArgs(argv: string[]): Query {
  let years = 3;
  let category = "";
  let limit = 20;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--years") years = Number(argv[++i] ?? 3) || 3;
    else if (a === "--category") category = argv[++i] ?? "";
    else if (a === "--limit") limit = Number(argv[++i] ?? 20) || 20;
  }
  return { years, category, limit };
}

async function main() {
  const q = parseArgs(process.argv.slice(2));
  const file = Bun.file(
    path.join(sourceDir("github-stars"), "stars.json"),
  );
  const snap = JSON.parse(await file.text()) as { count: number; repos: StarRepo[] };

  const cutoff = Date.now() - q.years * 365.25 * 86400_000;
  const inScope = snap.repos.filter((r) =>
    q.category ? categorize(r).name.toLowerCase().includes(q.category.toLowerCase()) : true,
  );

  const archived = inScope.filter((r) => r.archived);
  const stale = inScope.filter(
    (r) => !r.archived && r.pushed_at && new Date(r.pushed_at).getTime() < cutoff,
  );

  console.log(`# 保鲜检查（库共 ${snap.count}，检查范围 ${inScope.length}，阈值 ${q.years} 年）`);
  console.log(`archived: ${archived.length} 项 · 超 ${q.years} 年未推送: ${stale.length} 项`);

  const staleByCat = new Map<string, number>();
  for (const r of stale) {
    const c = categorize(r).name;
    staleByCat.set(c, (staleByCat.get(c) ?? 0) + 1);
  }
  console.log("\n## 老化分布（超阈值未推送，按分类）");
  for (const [c, n] of [...staleByCat.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`- ${c}: ${n}`);
  }

  const deadish = [...archived, ...stale].sort((a, b) => b.stars - a.stars).slice(0, q.limit);
  console.log(`\n## 最值得复查的 ${deadish.length} 项（按星数排）`);
  for (const r of deadish) {
    const mark = r.archived ? "🪦archived" : `⏳last push ${r.pushed_at.slice(0, 10)}`;
    console.log(`- ${r.full_name} ⭐${r.stars} (${mark}) — ${r.description.slice(0, 80)}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
