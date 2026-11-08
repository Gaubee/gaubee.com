#!/usr/bin/env bun
/**
 * x-daily-staleness — 译文已入库但日报未重渲染的「陈旧稿」检测
 *
 * 背景（2026-11-08/09 实证）：补译一条旧推文后，x.json 与译文库都更新了，但当初
 * 发布的日报文件还是旧渲染（没有译/原 toggle）。x-daily-trans-coverage 只管「缺译文」，
 * 管不到「有译文但没渲染」；今天两条（10-18、10-29）就是靠人眼在全量扫描里发现的。
 *
 * 判定：日报里的推文 id 在译文库（或 x.json 的 xTrans）里有译文，但同一份日报里
 * 没有该条的 `xl-<id>-zh` 切换控件 → 陈旧，需要用 --force 重渲染该日。
 *
 * 用法：
 *   bun tools/2026-11-09-x-daily-staleness/x-daily-staleness.ts [--date 2026-11-08]
 *   bun tools/2026-11-09-x-daily-staleness/x-daily-staleness.ts --last 10
 *   bun tools/2026-11-09-x-daily-staleness/x-daily-staleness.ts --strict
 * 退出码：0 = 无陈旧稿（--strict 且有发现时 1）；2 = 参数/文件异常。纯本地只读。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_REPORTS = path.resolve(import.meta.dir, "..", "..", "reports", "daily");
const DATA = process.env.GAUBEE_SKILLS_DATA ?? path.join(os.homedir(), ".gaubee-skills", "data");
const XJSON = path.join(DATA, "sources", "x-likes", "x.json");
const ZH = path.resolve(import.meta.dir, "..", "..", "translations", "x-tweets.zh.json");

interface Stale {
  id: string;
  author: string;
}

function reportIds(html: string): { id: string; author: string }[] {
  const out: { id: string; author: string }[] = [];
  for (const chunk of html.split('class="x-arch-item"').slice(1)) {
    const m = chunk.match(/status\/(\d{15,})/);
    if (!m) continue;
    const author = (chunk.match(/class="x-arch-author"[^>]*>([^<]*)</)?.[1] ?? "?").replace(/^@/, "");
    out.push({ id: m[1]!, author });
  }
  return out;
}

function audit(file: string, zh: Record<string, string>, xTrans: Record<string, string>, strict: boolean): number {
  const html = readFileSync(file, "utf8");
  const stale: Stale[] = [];
  const seen = new Set<string>();
  for (const { id, author } of reportIds(html)) {
    if (seen.has(id)) continue;
    seen.add(id);
    const hasTranslation = Boolean(zh[id] || xTrans[id]);
    if (!hasTranslation) continue;
    if (html.includes(`xl-${id}-zh`)) continue; // 已渲染译/原切换
    stale.push({ id, author });
  }
  const name = path.basename(file);
  if (stale.length === 0) {
    console.log(`${name}：清新`);
    return 0;
  }
  const date = name.slice(0, 10);
  console.log(`${name}：${stale.length} 条有译文但未渲染`);
  for (const s of stale) console.log(`  ✗ @${s.author} ${s.id}`);
  const runDate = new Date(`${date}T12:00:00`);
  runDate.setDate(runDate.getDate() + 1);
  const next = runDate.toLocaleDateString("sv-SE");
  console.log(`  修法：bun scripts/x-daily-events.ts --date ${date} --run-date ${next} --force`);
  if (strict) process.exitCode = 1;
  return stale.length;
}

function main(): number {
  const argv = process.argv.slice(2);
  const dateIdx = argv.indexOf("--date");
  const lastIdx = argv.indexOf("--last");
  const strict = argv.includes("--strict");
  const reportsIdx = argv.indexOf("--reports");
  const REPORTS = reportsIdx >= 0 ? path.resolve(argv[reportsIdx + 1] ?? "") : DEFAULT_REPORTS;
  for (const p of [REPORTS, XJSON, ZH]) {
    if (!existsSync(p)) {
      console.error(`缺少输入：${p}`);
      return 2;
    }
  }
  const zh = JSON.parse(readFileSync(ZH, "utf8")) as Record<string, string>;
  const store = JSON.parse(readFileSync(XJSON, "utf8")) as {
    items: Record<string, { xTrans?: string }>;
  };
  const xTrans: Record<string, string> = {};
  for (const [id, it] of Object.entries(store.items)) if (it.xTrans) xTrans[id] = it.xTrans;

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
    const n = lastIdx >= 0 ? Number(argv[lastIdx + 1]) || 10 : all.length;
    files = all.slice(-n).map((f) => path.join(REPORTS, f));
  }
  let total = 0;
  let staleFiles = 0;
  for (const f of files) {
    const n = audit(f, zh, xTrans, strict);
    total += n;
    if (n > 0) staleFiles++;
  }
  console.log(
    `\n合计 ${files.length} 份日报，陈旧稿 ${staleFiles} 份 / ${total} 条${total === 0 ? "（全部已渲染）" : ""}`,
  );
  return strict && total > 0 ? 1 : 0;
}

process.exit(main());
