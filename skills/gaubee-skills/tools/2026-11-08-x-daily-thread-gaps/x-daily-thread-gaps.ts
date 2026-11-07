#!/usr/bin/env bun
/**
 * x-daily-thread-gaps — X 日报线程标记缺链审计
 *
 * runbook 有一条线程兜底：昨日条目里带 🧵 或 n/m 序号、但 entry.thread 缺失的，
 * 要用 x-thread-backfill --ids 抓同作者全链。此前靠人眼扫报告，容易漏（2026-11-07
 * 的 hunch 推文就带着 🧵 发了出去）。本工具按日报产物逐条核对，直接给出可复制的
 * --ids 命令。
 *
 * 用法：
 *   bun tools/2026-11-08-x-daily-thread-gaps/x-daily-thread-gaps.ts [--date 2026-11-07]
 *   bun tools/2026-11-08-x-daily-thread-gaps/x-daily-thread-gaps.ts --last 7
 *   bun tools/2026-11-08-x-daily-thread-gaps/x-daily-thread-gaps.ts --date 2026-11-07 --strict
 * 退出码：0 = 报告完成（--strict 且有缺口时 1）；2 = 参数/文件异常。纯本地只读。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const REPORTS = path.resolve(import.meta.dir, "..", "..", "reports", "daily");
const DATA = process.env.GAUBEE_SKILLS_DATA ?? path.join(os.homedir(), ".gaubee-skills", "data");
const XJSON = path.join(DATA, "sources", "x-likes", "x.json");

interface Item {
  id: string;
  text?: string;
  author?: string;
  thread?: { id: string; text?: string }[];
}

/** 线程标记：🧵 或独立的 n/m 序号（先剥 URL，避免 /status/123 里的数字误命中） */
function threadSign(text: string): string | null {
  const bare = text.replace(/https?:\/\/\S+/g, " ");
  if (bare.includes("🧵")) return "🧵";
  const m = /(?:^|\s)(\d{1,2}\s*\/\s*\d{1,2})(?:\s|$)/.exec(bare);
  return m ? m[1]!.replace(/\s+/g, "") : null;
}

function reportIds(file: string): string[] {
  const html = readFileSync(file, "utf8");
  return [...new Set([...html.matchAll(/status\/(\d{15,})/g)].map((m) => m[1]!))];
}

function audit(file: string, items: Record<string, Item>, strict: boolean): number {
  const ids = reportIds(file);
  const gaps: { id: string; author: string; sign: string; preview: string }[] = [];
  let marked = 0;
  for (const id of ids) {
    const it = items[id];
    if (!it) continue;
    const sign = threadSign(it.text ?? "");
    if (!sign) continue;
    marked++;
    if ((it.thread ?? []).length > 1) continue;
    gaps.push({
      id,
      author: it.author ?? "?",
      sign,
      preview: (it.text ?? "").replace(/\s+/g, " ").slice(0, 60),
    });
  }
  console.log(`${path.basename(file)}：${ids.length} 条 · 带线程标记 ${marked} · 缺链 ${gaps.length}`);
  for (const g of gaps) console.log(`  ✗ ${g.sign} @${g.author} ${g.id}：${g.preview}…`);
  if (gaps.length > 0) {
    console.log(`  修法：bun tools/2026-10-24-x-thread-backfill/x-thread-backfill.ts --ids ${gaps.map((g) => g.id).join(",")}`);
    console.log("        抓完重跑 x-daily-events --date <报告日> 重渲染");
  }
  if (strict && gaps.length > 0) process.exitCode = 1;
  return gaps.length;
}

function main(): number {
  const argv = process.argv.slice(2);
  const dateIdx = argv.indexOf("--date");
  const lastIdx = argv.indexOf("--last");
  const strict = argv.includes("--strict");
  if (!existsSync(REPORTS)) {
    console.error(`reports 目录缺失：${REPORTS}`);
    return 2;
  }
  if (!existsSync(XJSON)) {
    console.error(`x.json 缺失：${XJSON}`);
    return 2;
  }
  const items = (JSON.parse(readFileSync(XJSON, "utf8")) as { items: Record<string, Item> }).items;
  const all = readdirSync(REPORTS)
    .filter((f) => /^\d{4}-\d{2}-\d{2}-x\.md$/.test(f))
    .sort();
  let files: string[];
  if (dateIdx >= 0) {
    const date = argv[dateIdx + 1];
    if (!date) {
      console.error("--date 需要一个 YYYY-MM-DD");
      return 2;
    }
    const target = path.join(REPORTS, `${date}-x.md`);
    if (!existsSync(target)) {
      console.error(`没有该日报：${target}`);
      return 2;
    }
    files = [target];
  } else {
    const n = lastIdx >= 0 ? Number(argv[lastIdx + 1]) || 7 : all.length;
    files = all.slice(-n).map((f) => path.join(REPORTS, f));
  }
  let total = 0;
  for (const f of files) total += audit(f, items, strict);
  console.log(`\n合计 ${files.length} 份日报，缺链 ${total} 条${total === 0 ? "（线程标记全部有链或无需抓链）" : ""}`);
  return strict && total > 0 ? 1 : 0;
}

process.exit(main());
