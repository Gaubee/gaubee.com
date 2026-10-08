#!/usr/bin/env bun
/**
 * taxonomy-count-doctor — taxonomy.md 分类括号计数体检
 *
 * 背景（2026-10-08 每日维护实测）：taxonomy.md 各分类标题里的括号数字靠 agent 手写，
 * 与 `github-stars-categorize.ts --stats` 的脚本权威计数会发生漂移（当日实测两处：
 * 标 153 实 154、标 96 实 95），此前只能靠人工核对发现。
 *
 * 做什么：
 *   1. 解析 taxonomy.md 的 `### <分类名>（<n>）` 标题行；
 *   2. 跑 categorize --stats 取脚本权威计数；
 *   3. 输出漂移表（分类名/标称/实数/差值），全部对齐时打印 OK；
 *   4. `--fix` 把 taxonomy.md 标签改写为脚本值（写前备份 taxonomy.md.bak）。
 *
 * 用法：
 *   bun taxonomy-count-doctor.ts            # 只体检，不改文件
 *   bun taxonomy-count-doctor.ts --fix      # 体检 + 修正标签（先备份）
 *
 * 零第三方依赖；taxonomy 路径可用 TAXONOMY_FILE 覆盖（默认 ~/.gaubee-skills/data/taxonomy.md）。
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

interface Heading {
  line: number;
  name: string;
  declared: number;
}
interface Stat {
  name: string;
  actual: number;
}
interface Drift {
  name: string;
  declared: number;
  actual: number;
}

const args = process.argv.slice(2);
if (args.some((a) => a !== "--fix")) {
  console.error("用法: bun taxonomy-count-doctor.ts [--fix]");
  process.exit(2);
}
const fix = args.includes("--fix");

const TAXONOMY =
  process.env.TAXONOMY_FILE ?? join(homedir(), ".gaubee-skills/data/taxonomy.md");

const headingRe = /^### (.+?)[（(](\d+)[）)]\s*$/;
const text = readFileSync(TAXONOMY, "utf8");
const headings: Heading[] = [];
text.split("\n").forEach((line, i) => {
  const m = headingRe.exec(line);
  if (m) headings.push({ line: i, name: m[1]!.trim(), declared: Number(m[2]) });
});
if (headings.length === 0) {
  console.error(`taxonomy-count-doctor: 未在 ${TAXONOMY} 解析到任何分类标题`);
  process.exit(1);
}

// 脚本权威计数：categorize --stats 输出形如 "154\tAI Agent 与编码助手"（TAB 分隔）
const skillDir =
  process.env.SKILL_DIR ?? join(homedir(), ".agents/skills/gaubee-skills");
const statsOut = execFileSync("bun", [
  join(skillDir, "scripts/github-stars-categorize.ts"),
  "--stats",
], { encoding: "utf8" });
const stats: Stat[] = [];
for (const line of statsOut.split("\n")) {
  const m = /^(\d+)\s+(.+)$/.exec(line.trim());
  if (m) stats.push({ actual: Number(m[1]), name: m[2]!.trim() });
}
const statByName = new Map(stats.map((s) => [s.name, s.actual] as const));

const drifts: Drift[] = [];
const missing: string[] = [];
for (const h of headings) {
  const actual = statByName.get(h.name);
  if (actual === undefined) {
    missing.push(h.name);
    continue;
  }
  if (actual !== h.declared) drifts.push({ name: h.name, declared: h.declared, actual });
}

console.log(`taxonomy-count-doctor：${TAXONOMY}`);
console.log(`分类标题 ${headings.length} 个，脚本计数 ${stats.length} 个`);
if (missing.length > 0) {
  console.log(`\n脚本无计数（新分类或名字对不上，人工确认）：`);
  for (const name of missing) console.log(`  ? ${name}`);
}
if (drifts.length === 0) {
  console.log("\nOK：全部括号计数与脚本权威值一致");
  process.exit(0);
}

console.log("\n漂移（标称 → 实数）：");
for (const d of drifts) {
  console.log(`  ${d.name}：${d.declared} → ${d.actual}（差 ${d.actual - d.declared >= 0 ? "+" : ""}${d.actual - d.declared}）`);
}

if (!fix) {
  console.log(`\n${drifts.length} 处漂移。加 --fix 以脚本为准改写标签（先备份 .bak）。`);
  process.exit(1);
}

// 逐行重建标题：沿用原标题实际使用的括号字符（全角/半角）
const lines = text.split("\n");
for (const d of drifts) {
  const h = headings.find((x) => x.name === d.name)!;
  const line = lines[h.line]!;
  const open = line.includes("（") ? "（" : "(";
  const close = line.includes("（") ? "）" : ")";
  lines[h.line] = `### ${d.name}${open}${d.actual}${close}`;
}
const tmpBackup = join(mkdtempSync(join(tmpdir(), "taxonomy-doctor-")), "taxonomy.md.bak");
writeFileSync(tmpBackup, text);
const bak = `${TAXONOMY}.bak`;
renameSync(tmpBackup, bak);
writeFileSync(TAXONOMY, lines.join("\n"));
console.log(`\n已修正 ${drifts.length} 处标签（原文件备份到 ${bak}）`);
