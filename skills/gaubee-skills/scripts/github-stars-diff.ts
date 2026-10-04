#!/usr/bin/env bun
/**
 * github-stars-diff.ts — 星标变更检测（source: github-stars）
 *
 * 文件意图（正交意图清单）：
 * - [2026-10-03] 原始需求（kzf）：每天定时抓取、找出变更项、出报告。
 * - 1. 对比 data/sources/github-stars/stars.json 与上一份历史快照 → added/removed/changed
 * - 2. 变更落盘 data/sources/github-stars/changes/<date>.json；stdout 输出 markdown 摘要
 *
 * 运行：bun scripts/github-stars-diff.ts（在 github-stars-fetch.ts 之后）
 */
import { mkdirSync, readdirSync } from "node:fs";
import path from "node:path";

import { localDate, sourceDir, writeFileAtomic, type Snapshot, type StarRepo } from "./lib.ts";

const SRC = sourceDir("github-stars");
const HISTORY = path.join(SRC, "history");
const CHANGES = path.join(SRC, "changes");

/** 参与变更检测的字段（star 数/pushed_at 波动太吵，不纳入） */
const WATCH_KEYS = [
  "description",
  "homepage",
  "language",
  "topics",
  "archived",
] as const satisfies readonly (keyof StarRepo)[];

interface ChangesFile {
  date: string;
  prev_date: string;
  baseline: boolean;
  added: StarRepo[];
  removed: StarRepo[];
  changed: {
    full_name: string;
    html_url: string;
    from: Record<string, unknown>;
    to: Record<string, unknown>;
  }[];
}

/** 序列化比较；数组（topics）先排序，避免 GitHub 返回顺序变化误报 */
function norm(v: unknown): string {
  return Array.isArray(v) ? JSON.stringify([...v].sort()) : JSON.stringify(v);
}

function diff(prev: StarRepo[], cur: StarRepo[]) {
  const prevMap = new Map(prev.map((r) => [r.full_name, r]));
  const curMap = new Map(cur.map((r) => [r.full_name, r]));
  const added = cur.filter((r) => !prevMap.has(r.full_name));
  const removed = prev.filter((r) => !curMap.has(r.full_name));
  const changed: ChangesFile["changed"] = [];
  for (const [name, c] of curMap) {
    const p = prevMap.get(name);
    if (!p) continue;
    const from: Record<string, unknown> = {};
    const to: Record<string, unknown> = {};
    let touched = false;
    for (const k of WATCH_KEYS) {
      if (norm(p[k]) !== norm(c[k])) {
        from[k] = p[k];
        to[k] = c[k];
        touched = true;
      }
    }
    if (touched) changed.push({ full_name: name, html_url: c.html_url, from, to });
  }
  return { added, removed, changed };
}

async function main() {
  const cur: Snapshot = JSON.parse(await Bun.file(path.join(SRC, "stars.json")).text());
  const today = localDate();

  const prevFiles = readdirSync(HISTORY)
    .filter((f) => f.endsWith(".json") && f !== `${today}.json`)
    .sort();
  if (prevFiles.length === 0) {
    console.log("BASELINE 无历史快照可对比；今天的快照即基线，日报请写「基线建立」。");
    return;
  }
  const prevFile = prevFiles.at(-1)!;
  const prev: Snapshot = JSON.parse(await Bun.file(path.join(HISTORY, prevFile)).text());

  const { added, removed, changed } = diff(prev.repos, cur.repos);
  const result: ChangesFile = {
    date: today,
    prev_date: prevFile.replace(".json", ""),
    baseline: false,
    added,
    removed,
    changed,
  };

  mkdirSync(CHANGES, { recursive: true });
  writeFileAtomic(path.join(CHANGES, `${today}.json`), JSON.stringify(result, null, 1));

  const lines: string[] = [
    `# 星标变更 ${today}（对比 ${result.prev_date}）`,
    `新增 ${added.length} 个，移除 ${removed.length} 个，元数据变化 ${changed.length} 个`,
  ];
  if (added.length) {
    lines.push(
      "",
      "## 新增",
      ...added.map(
        (r) =>
          `- [${r.full_name}](${r.html_url}) — ${r.description || "(无描述)"} [${r.language || "?"}]`,
      ),
    );
  }
  if (removed.length) {
    lines.push(
      "",
      "## 移除",
      ...removed.map((r) => `- ${r.full_name} — ${r.description || "(无描述)"}`),
    );
  }
  if (changed.length) {
    lines.push(
      "",
      "## 元数据变化",
      ...changed.map((c) => {
        const parts = Object.keys(c.to).map(
          (k) => `${k}: ${JSON.stringify(c.from[k])} → ${JSON.stringify(c.to[k])}`,
        );
        return `- [${c.full_name}](${c.html_url}) ${parts.join("; ")}`;
      }),
    );
  }
  console.log(lines.join("\n"));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
