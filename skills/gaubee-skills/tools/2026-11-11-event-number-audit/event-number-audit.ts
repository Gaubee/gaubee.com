#!/usr/bin/env bun
/**
 * event-number-audit — 站点 event 编号与 slug 完整性体检
 *
 * events 目录用 `<5位序号>.<slug>.md` 命名，发布脚本靠扫描目录自增序号。历史上出过
 * 两类事故：同一 slug 被发布两次（编号不同、内容重复），以及删除重复后留下编号空洞。
 * 本工具逐项核对：
 *   1. 编号重复（硬错，两个文件抢同一序号）
 *   2. slug 重复（硬错，同一天同一份报告发了两次）
 *   3. 编号空洞（提示，正常删除重复后会留洞）
 *
 * 用法：bun tools/2026-11-11-event-number-audit/event-number-audit.ts [--root <仓库根>] [--json]
 * 退出码：0 = 无硬错；1 = 有编号/slug 重复；2 = 目录缺失。纯本地只读。
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const DEFAULT_ROOT = path.resolve(import.meta.dir, "..", "..", "..", "..");

interface EventFile {
  file: string;
  num: number;
  slug: string;
}

function main(): number {
  const argv = process.argv.slice(2);
  const rootIdx = argv.indexOf("--root");
  const root = rootIdx >= 0 ? path.resolve(argv[rootIdx + 1] ?? "") : DEFAULT_ROOT;
  const asJson = argv.includes("--json");
  const dir = path.join(root, "src", "content", "events");
  if (!existsSync(dir)) {
    console.error(`events 目录缺失：${dir}`);
    return 2;
  }
  const events: EventFile[] = [];
  const badNames: string[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".md")) continue;
    const m = f.match(/^(\d{5})\.(.+)\.md$/);
    if (!m) {
      badNames.push(f);
      continue;
    }
    events.push({ file: f, num: Number(m[1]), slug: m[2]! });
  }

  const byNum = new Map<number, EventFile[]>();
  const bySlug = new Map<string, EventFile[]>();
  for (const e of events) {
    byNum.set(e.num, [...(byNum.get(e.num) ?? []), e]);
    bySlug.set(e.slug, [...(bySlug.get(e.slug) ?? []), e]);
  }
  const dupNums = [...byNum.entries()].filter(([, list]) => list.length > 1);
  const dupSlugs = [...bySlug.entries()].filter(([, list]) => list.length > 1);
  const nums = [...byNum.keys()].sort((a, b) => a - b);
  const missing: number[] = [];
  for (let n = nums[0] ?? 1; n <= (nums.at(-1) ?? 0); n++) {
    if (!byNum.has(n)) missing.push(n);
  }

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          total: events.length,
          badNames,
          duplicateNumbers: dupNums.map(([n, l]) => ({ num: n, files: l.map((e) => e.file) })),
          duplicateSlugs: dupSlugs.map(([s, l]) => ({ slug: s, files: l.map((e) => e.file) })),
          missingNumbers: missing,
        },
        null,
        2,
      ),
    );
    return dupNums.length || dupSlugs.length ? 1 : 0;
  }

  console.log(
    `event ${events.length} 个｜编号 ${nums[0] ?? "-"}~${nums.at(-1) ?? "-"}｜空洞 ${missing.length}｜重号 ${dupNums.length}｜重复 slug ${dupSlugs.length}`,
  );
  if (badNames.length) {
    console.log(`命名不合规 ${badNames.length} 个：`);
    for (const f of badNames.slice(0, 8)) console.log(`  · ${f}`);
  }
  for (const [n, list] of dupNums) {
    console.log(`  ✗ 重号 ${String(n).padStart(5, "0")}：${list.map((e) => e.file).join(" / ")}`);
  }
  for (const [s, list] of dupSlugs) {
    console.log(`  ✗ 重复 slug ${s}：${list.map((e) => e.file).join(" / ")}`);
  }
  if (missing.length) {
    console.log(`  编号空洞（正常删除重复后的残留）：${missing.slice(0, 12).join(", ")}${missing.length > 12 ? " …" : ""}`);
  }
  if (dupNums.length || dupSlugs.length) {
    console.log("\n修法：重复 slug 只保留正式版，其余 git rm（保留 git 历史），编号空洞不用补。");
    return 1;
  }
  console.log("\nEVENT AUDIT OK：无重号、无重复 slug");
  return 0;
}

process.exit(main());
