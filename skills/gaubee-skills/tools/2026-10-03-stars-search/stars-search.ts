#!/usr/bin/env bun
/**
 * stars-search.ts — 本地星标速查（gaubee-skills 工具工坊提案 #1，2026-10-03）
 *
 * 文件意图（正交意图清单）：
 * - [2026-10-03] 原始需求（kzf）：问工具建议时，agent 应先在本地收藏里检索候选，而不是凭记忆。
 * - 1. 多关键词 AND 检索 stars.json（full_name 权重 3 > topics 2 > 描述 1.5）
 * - 2. 可按分类（--category，复用 scripts/github-stars-categorize.ts 规则）与语言（--lang）过滤
 *
 * 用法：bun stars-search.ts <关键词...> [--category <分类子串>] [--lang <语言>] [--limit 10]
 */
import path from "node:path";

import { categorize } from "../../scripts/github-stars-categorize.ts";

interface StarRepo {
  full_name: string;
  html_url: string;
  description: string;
  language: string;
  topics: string[];
  stars: number;
  archived: boolean;
  starred_at: string;
}

interface Query {
  keywords: string[];
  category: string;
  lang: string;
  limit: number;
}

function parseArgs(argv: string[]): Query {
  const keywords: string[] = [];
  let category = "";
  let lang = "";
  let limit = 10;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--category") category = argv[++i] ?? "";
    else if (a === "--lang") lang = argv[++i] ?? "";
    else if (a === "--limit") limit = Number(argv[++i] ?? 10) || 10;
    else keywords.push(a.toLowerCase());
  }
  return { keywords, category, lang, limit };
}

function score(r: StarRepo, keywords: string[]): number {
  const name = r.full_name.toLowerCase();
  const topics = r.topics.join(" ").toLowerCase();
  const desc = r.description.toLowerCase();
  let total = 0;
  for (const k of keywords) {
    let best = 0;
    if (name.includes(k)) best = Math.max(best, 3);
    if (topics.includes(k)) best = Math.max(best, 2);
    if (desc.includes(k)) best = Math.max(best, 1.5);
    if (best === 0) return 0; // 关键词必须全部命中（AND）
    total += best;
  }
  return total;
}

async function main() {
  const q = parseArgs(process.argv.slice(2));
  if (q.keywords.length === 0 && !q.category && !q.lang) {
    console.error(
      "用法：bun stars-search.ts <关键词...> [--category <分类子串>] [--lang <语言>] [--limit 10]",
    );
    process.exit(2);
  }
  const file = Bun.file(
    path.resolve(import.meta.dir, "../../data/sources/github-stars/stars.json"),
  );
  const snap = JSON.parse(await file.text()) as { count: number; repos: StarRepo[] };

  const hits = snap.repos
    .filter((r) => (q.lang ? r.language.toLowerCase() === q.lang.toLowerCase() : true))
    .filter((r) =>
      q.category ? categorize(r).name.toLowerCase().includes(q.category.toLowerCase()) : true,
    )
    .map((r) => ({ r, s: q.keywords.length ? score(r, q.keywords) : 1 }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || b.r.stars - a.r.stars)
    .slice(0, q.limit);

  console.log(`# ${hits.length} hits（库共 ${snap.count} 项）`);
  for (const { r } of hits) {
    const cat = categorize(r).name;
    console.log(
      `- ${r.full_name} ⭐${r.stars} [${r.language || "?"}] (${cat})${r.archived ? " 🪦archived" : ""}`,
    );
    if (r.description) console.log(`  ${r.description.slice(0, 110)}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
