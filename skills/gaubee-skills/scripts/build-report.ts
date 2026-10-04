#!/usr/bin/env bun
/**
 * build-report.ts — 周报/月报骨架（跨源聚合）
 *
 * 文件意图（正交意图清单）：
 * - [2026-10-03] 原始需求（kzf）：日报之外还要周报/月报；未来接入更多信号源后报告自动纳管。
 * - 1. 逐源读取 data/sources 下各源的 changes 目录，聚合指定周期（新增源零改动接入）
 * - 2. --weekly [reports/weekly/YYYY-Www.md] / --monthly [reports/monthly/YYYY-MM.md] / --yearly [YYYY]（默认上一年，reports/yearly/YYYY.md）
 * 叙述分析（品味信号、主题归纳）由 agent 在骨架上补充，脚本只负责事实聚合。
 * 注意：本文件注释与字符串里禁止出现「星号+斜杠」序列（JSDoc 会提前闭合，2026-10-03 复核实证）。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { DATA, ROOT, localDate, writeFileAtomic } from "./lib.ts";

const SOURCES_ROOT = path.join(DATA, "sources");
const REPORTS = path.join(ROOT, "reports");

interface ChangeEntry {
  source: string;
  date: string;
  added: { full_name: string; html_url: string; description: string; language: string }[];
  removed: { full_name: string }[];
  changed: unknown[];
}

const p2 = (n: number) => String(n).padStart(2, "0");

function isoWeek(d: Date): { year: number; week: number } {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
  return { year, week };
}

function mondayOf(d: Date): Date {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  t.setDate(t.getDate() - ((t.getDay() + 6) % 7));
  return t;
}

/** 聚合所有源在 [from, to] 的变更文件 */
function loadChanges(from: string, to: string): ChangeEntry[] {
  if (!existsSync(SOURCES_ROOT)) return [];
  const out: ChangeEntry[] = [];
  for (const source of readdirSync(SOURCES_ROOT)) {
    const dir = path.join(SOURCES_ROOT, source, "changes");
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      const date = f.replace(".json", "");
      if (date < from || date > to) continue;
      const data = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as ChangeEntry;
      out.push({
        source,
        date,
        added: data.added ?? [],
        removed: data.removed ?? [],
        changed: data.changed ?? [],
      });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

function render(
  kind: "weekly" | "monthly" | "yearly",
  entries: ChangeEntry[],
  rangeLabel: string,
): string {
  const label = kind === "weekly" ? "周报" : kind === "monthly" ? "月报" : "年报";
  const perDay = new Map<string, ChangeEntry[]>();
  for (const e of entries) {
    if (!perDay.has(e.date)) perDay.set(e.date, []);
    perDay.get(e.date)!.push(e);
  }
  const added = entries.flatMap((e) =>
    e.added.map((r) => ({ ...r, day: e.date, source: e.source })),
  );
  const removedCount = entries.reduce((n, e) => n + e.removed.length, 0);
  const changedCount = entries.reduce((n, e) => n + e.changed.length, 0);

  const lines: string[] = [
    `# ${label} ${rangeLabel}`,
    "",
    "> 事实骨架由 scripts/build-report.ts 生成；分析由每日维护 agent 补充。",
    "",
    "## 概览",
    "",
    `- 新增：**${added.length}** 项`,
    `- 移除：${removedCount} 项`,
    `- 元数据变化：${changedCount} 项`,
    "",
    "## 逐日 × 源",
    "",
    "| 日期 | 源 | 新增 | 移除 | 元数据 |",
    "| --- | --- | --- | --- | --- |",
    ...(perDay.size
      ? [...perDay.entries()].flatMap(([date, es]) =>
          es.map(
            (e) =>
              `| ${date} | ${e.source} | ${e.added.length} | ${e.removed.length} | ${e.changed.length} |`,
          ),
        )
      : ["| (本周期无变更记录) | - | - | - | - |"]),
  ];
  if (added.length) {
    lines.push(
      "",
      "## 本期新增明细",
      "",
      ...added.map(
        (r) =>
          `- **${r.day}** \`${r.source}\` [${r.full_name}](${r.html_url}) — ${r.description || "(无描述)"}${r.language ? ` [${r.language}]` : ""}`,
      ),
    );
  }
  lines.push(
    "",
    "## 分析（agent 补充）",
    "",
    "<!-- 主题聚类、与 profile.md 品味画像的印证/漂移、造工具进展与裁决情况 -->",
    "",
  );
  return lines.join("\n");
}

function main(): void {
  const mode = process.argv[2];
  const argc = process.argv.length;
  // 合法形态：--weekly/--monthly（无附加参数）；--yearly [YYYY]
  const valid =
    mode === "--weekly" || mode === "--monthly"
      ? argc === 3
      : mode === "--yearly"
        ? argc === 3 || (argc === 4 && /^\d{4}$/.test(process.argv[3] ?? ""))
        : false;
  if (!valid) {
    console.error(`无法识别的参数：${process.argv.slice(3).join(" ")}（一次只跑一种模式）`);
    console.error("usage: bun scripts/build-report.ts --weekly|--monthly|--yearly [YYYY]");
    process.exit(2);
  }
  const today = localDate();
  const now = new Date();

  if (mode === "--weekly") {
    const mon = mondayOf(now);
    const entries = loadChanges(localDate(mon), today);
    const { year, week } = isoWeek(now);
    const out = path.join(REPORTS, "weekly", `${year}-W${p2(week)}.md`);
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileAtomic(
      out,
      render("weekly", entries, `${year}-W${p2(week)}（${localDate(mon)} ~ ${today}）`),
    );
    console.log(`written ${out} (${entries.length} change files)`);
  } else if (mode === "--monthly") {
    const from = `${today.slice(0, 7)}-01`;
    const entries = loadChanges(from, today);
    const out = path.join(REPORTS, "monthly", `${today.slice(0, 7)}.md`);
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileAtomic(out, render("monthly", entries, today.slice(0, 7)));
    console.log(`written ${out} (${entries.length} change files)`);
  } else if (mode === "--yearly") {
    // 年报：默认上一年度整年；显式传年份则取该年（未结束的年份截至今天）
    const yearArg = process.argv[3];
    const year =
      yearArg && /^\d{4}$/.test(yearArg) ? yearArg : String(Number(today.slice(0, 4)) - 1);
    const from = `${year}-01-01`;
    const to = year >= today.slice(0, 4) ? today : `${year}-12-31`;
    const entries = loadChanges(from, to);
    const out = path.join(REPORTS, "yearly", `${year}.md`);
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileAtomic(out, render("yearly", entries, `${year} 年度（${from} ~ ${to}）`));
    console.log(`written ${out} (${entries.length} change files)`);
  } else {
    console.error("usage: bun scripts/build-report.ts --weekly|--monthly|--yearly [YYYY]");
    process.exit(2);
  }
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
