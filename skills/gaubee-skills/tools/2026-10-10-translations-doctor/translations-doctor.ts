#!/usr/bin/env bun
/**
 * translations-doctor.ts — X 译文覆盖率体检（工具工坊 2026-10-10）
 *
 * 解决什么：translations/x-tweets.zh.json 对 x.json 的覆盖缺口拖到 2026-10-10 才被
 * Owner 发现（漏了 4 天的采集译文）。本工具一条命令输出覆盖率全貌，供 cron 第 5 步
 * 译文增量前后各跑一次（前=找出缺口，后=确认归零）。
 *
 * 怎么跑：bun tools/2026-10-10-translations-doctor/translations-doctor.ts [--fail-when-missing]
 *   --fail-when-missing：非中文正文缺译数 > 0 时退出码 1（供 cron 门禁）。
 * 判定口径（与 x-translations-export.ts 一致）：需要翻译 = text 非空 且 译文缺失 且
 * 原文非中文（中文原文不出译/原 toggle，无需翻译）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const failWhenMissing = process.argv.includes("--fail-when-missing");

const DATA = process.env.GAUBEE_SKILLS_DATA ?? path.join(process.env.HOME!, ".gaubee-skills", "data");
const X = path.join(DATA, "sources", "x-likes", "x.json");
const ZH = path.resolve(import.meta.dir, "..", "..", "translations", "x-tweets.zh.json");

const hasCJK = (s: string): boolean => /[\u4e00-\u9fff]/.test(s);

interface Tweet { id: string; text?: string; created_at?: string }
const store = JSON.parse(readFileSync(X, "utf8")) as { items: Record<string, Tweet> };
const zh = JSON.parse(readFileSync(ZH, "utf8")) as Record<string, string>;

const items = Object.values(store.items);
const missing = items
  .filter((t) => (t.text ?? "").trim() && !zh[t.id] && !hasCJK(t.text ?? ""))
  .map((t) => ({ id: t.id, created_at: t.created_at ?? "" }));

const byDay = new Map<string, number>();
for (const m of missing) {
  const d = m.created_at.slice(0, 10);
  byDay.set(d, (byDay.get(d) ?? 0) + 1);
}

console.log(`x.json 总条目 ${items.length} · 已有译文 ${Object.keys(zh).length}`);
console.log(`非中文正文缺译：${missing.length}`);
if (missing.length > 0) {
  const days = [...byDay.entries()].sort();
  console.log("按日缺口分布：");
  for (const [d, n] of days) console.log(`  ${d}  ${n}`);
  console.log("下一步：bun scripts/x-translations-export.ts 导出 → Agent 自译 → --verify → x-translations-merge.ts");
} else {
  console.log("覆盖率完整：无待翻译条目");
}
process.exit(missing.length > 0 && failWhenMissing ? 1 : 0);
