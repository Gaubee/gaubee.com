#!/usr/bin/env bun
/**
 * stars-drift — 星标兴趣漂移月览
 *
 * 问题：「最近一个月我在关注什么？和上个月比兴趣往哪漂？」catalog 是全量静态视图，
 * 没有时间维度的聚合。本工具读 catalog.md 的分类映射 + stars.json 的 starred_at，
 * 输出最近 N 天（默认 30）按 taxonomy 分类的星标分布、与前一个同长窗口的对比、
 * 新星标里的主力语言。
 *
 * 用法：bun tools/2026-10-25-stars-drift/stars-drift.ts [--days 30]
 * 退出码：0 正常；1 数据缺失。纯本地秒级，零网络零写入。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const DATA = process.env.GAUBEE_SKILLS_DATA ?? path.join(os.homedir(), ".gaubee-skills", "data");
const CATALOG = path.join(DATA, "sources", "github-stars", "catalog.md");
const STARS = path.join(DATA, "sources", "github-stars", "stars.json");

interface Star {
  repo?: { name?: string }; // full_name "owner/name"
  full_name?: string;
  starred_at?: string;
  language?: string;
}

function repoKey(s: Star): string {
  return s.full_name ?? s.repo?.name ?? "";
}

/** catalog.md → repo 全名 → 分类名 */
function loadCatalogMap(): Map<string, string> {
  const map = new Map<string, string>();
  let cat = "未分类";
  for (const line of readFileSync(CATALOG, "utf8").split("\n")) {
    const h = line.match(/^## (.+?)（\d+ 项）$/);
    if (h) {
      cat = h[1]!.trim();
      continue;
    }
    const it = line.match(/^- \[([^\]]+\/[^\]]+)\]\(https:\/\/github\.com\//);
    if (it) map.set(it[1]!, cat);
  }
  return map;
}

function main(): number {
  if (!existsSync(CATALOG) || !existsSync(STARS)) {
    console.error(`数据缺失：${CATALOG} 或 ${STARS}`);
    return 1;
  }
  const argv = process.argv.slice(2);
  const days = Math.max(1, Number(argv[argv.indexOf("--days") + 1] ?? 30) || 30);
  const catMap = loadCatalogMap();
  const raw = JSON.parse(readFileSync(STARS, "utf8")) as { repos?: Star[] };
  const stars = raw.repos ?? [];

  const now = Date.now();
  const dayMs = 24 * 3600_000;
  const win: Star[] = [];
  const prev: Star[] = [];
  for (const s of stars) {
    const t = s.starred_at ? Date.parse(s.starred_at) : 0;
    if (!t) continue;
    const age = now - t;
    if (age <= days * dayMs) win.push(s);
    else if (age <= 2 * days * dayMs) prev.push(s);
  }

  const count = (list: Star[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const s of list) {
      const c = catMap.get(repoKey(s)) ?? "未分类";
      m.set(c, (m.get(c) ?? 0) + 1);
    }
    return m;
  };
  const cur = count(win);
  const before = count(prev);
  const cats = [...new Set([...cur.keys(), ...before.keys()])]
    .map((c) => ({ c, n: cur.get(c) ?? 0, p: before.get(c) ?? 0, d: (cur.get(c) ?? 0) - (before.get(c) ?? 0) }))
    .filter((x) => x.n > 0 || x.p > 0)
    .sort((a, b) => b.n - a.n || b.d - a.d);

  const langs = new Map<string, number>();
  for (const s of win) {
    const l = s.language;
    if (l) langs.set(l, (langs.get(l) ?? 0) + 1);
  }
  const topLangs = [...langs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  console.log(`窗口：最近 ${days} 天 ${win.length} 个新星标（前一个 ${days} 天 ${prev.length} 个；星标全集 ${stars.length}）`);
  console.log("");
  console.log("分类分布（本期 / 上期 / 增减）：");
  for (const x of cats.slice(0, 10)) {
    const trend = x.d > 0 ? `+${x.d}` : String(x.d);
    console.log(`  ${x.c}：${x.n} / ${x.p}（${trend}）`);
  }
  if (topLangs.length) {
    console.log("");
    console.log(`新星标主力语言：${topLangs.map(([l, n]) => `${l} ${n}`).join("、")}`);
  }
  return 0;
}

process.exit(main());
