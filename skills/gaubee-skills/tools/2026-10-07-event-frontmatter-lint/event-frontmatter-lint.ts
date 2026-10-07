#!/usr/bin/env bun
/**
 * event-frontmatter-lint —— 站点 events frontmatter 体检器（gaubee-skills 工具工坊 2026-10-07）
 *
 * 解决什么：events 目录（src/content/events/，1300+ 文件）的 frontmatter 规范已在
 * openspec/specs/event-app/spec.md R2 冻结——报告类 event 的 title 是「最近事件」widget
 * 的展示键，格式漂移会直接劣化首页观感。本工具机械校验防漂移：
 *   (a) github-daily-/x-daily-/github-weekly-/github-monthly-/github-yearly- 文件的 title
 *       匹配对应 R2 正则（全角冒号）
 *   (b) date 可解析且不晚于今天
 *   (c) 报告类文件 tags 必含 event（归档豁免）
 *   (d) 抽验正文 /x-media/ 引用在 static/ 下真实存在（防断链）
 *
 * 怎么跑：
 *   bun skills/gaubee-skills/tools/2026-10-07-event-frontmatter-lint/event-frontmatter-lint.ts
 * 退出码：0 = 全过；1 = 有违规。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dir, "../../../..");
const EVENTS_DIR = path.join(REPO_ROOT, "src", "content", "events");
const STATIC_ROOT = path.join(REPO_ROOT, "static");

const TITLE_RULES: [RegExp, string][] = [
  [/^github-daily-(\d{4}-\d{2}-\d{2})\.md$/, /^GitHub 日报：\d{4}-\d{2}-\d{2}$/],
  [/^x-daily-(\d{4}-\d{2}-\d{2})\.md$/, /^X 日报：\d{4}-\d{2}-\d{2}$/],
  [/^github-weekly-.+\.md$/, /^GitHub 周报：\d{4}-\d{2}-\d{2}～\d{4}-\d{2}-\d{2}$/],
  [/^github-monthly-(\d{4}-\d{2})\.md$/, /^GitHub 月报：\d{4}-\d{2}$/],
  [/^github-yearly-(\d{4})\.md$/, /^GitHub 年报：\d{4}$/],
];

type Check = { file: string; problem: string };

function parseFrontmatter(text: string): Record<string, string | string[]> {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!m) return {};
  const out: Record<string, string | string[]> = {};
  let curKey = "";
  for (const line of m[1].split("\n")) {
    const list = /^  - (.+)$/.exec(line);
    if (list && curKey) {
      if (!Array.isArray(out[curKey])) out[curKey] = [];
      (out[curKey] as string[]).push(list[1].trim());
      continue;
    }
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (kv) { curKey = kv[1]; out[curKey] = kv[2].replace(/^["']|["']$/g, ""); }
  }
  return out;
}

function main(): void {
  const problems: Check[] = [];
  const files = readdirSync(EVENTS_DIR).filter((f) => f.endsWith(".md"));
  const today = new Date().toISOString().slice(0, 10);
  let mediaRefs = 0, mediaMissing = 0;

  for (const f of files) {
    const full = path.join(EVENTS_DIR, f);
    const text = readFileSync(full, "utf8");
    const fm = parseFrontmatter(text);

    // (a) 报告类 title 规范
    for (const [fileRe, titleRe] of TITLE_RULES) {
      if (fileRe.test(f)) {
        const title = String(fm.title ?? "");
        if (!titleRe.test(title)) {
          problems.push({ file: f, problem: `title「${title}」不符 R2 规范（期望 ${titleRe.source}）` });
        }
        break;
      }
    }

    // (b) date 合法且不晚于今天
    const dateRaw = String(fm.date ?? "");
    const d = new Date(dateRaw);
    if (!dateRaw || Number.isNaN(d.getTime())) {
      problems.push({ file: f, problem: `date 不可解析: 「${dateRaw}」` });
    } else if (dateRaw.slice(0, 10) > today) {
      problems.push({ file: f, problem: `date 晚于今天: ${dateRaw.slice(0, 10)}` });
    }

    // (c) 报告类文件 tags 必含 event（x-archive 归档自有 x-archive 标签体系，豁免——
    //     spec R2 只冻结报告类 title，event 标签语义属于 publish.ts 策展链路）
    const isReport = TITLE_RULES.some(([fileRe]) => fileRe.test(f));
    const tags = fm.tags;
    const tagList = Array.isArray(tags) ? tags : typeof tags === "string" && tags ? [tags] : [];
    if (isReport && !tagList.includes("event")) {
      problems.push({ file: f, problem: `报告类 tags 缺 event（现: ${JSON.stringify(tags)}）` });
    }

    // (d) 正文 /x-media/ 引用抽验
    for (const m of text.matchAll(/\/x-media\/([A-Za-z0-9._/-]+\.(?:jpg|jpeg|png|webp|gif|mp4))/g)) {
      mediaRefs++;
      if (!existsSync(path.join(STATIC_ROOT, "x-media", m[1]))) {
        mediaMissing++;
        if (mediaMissing <= 5) problems.push({ file: f, problem: `媒体断链: /x-media/${m[1]}` });
      }
    }
  }

  console.log(`扫描 ${files.length} 个 event；媒体引用 ${mediaRefs} 处，断链 ${mediaMissing}`);
  if (problems.length) {
    console.log(`\n[FAIL] ${problems.length} 项违规:`);
    for (const p of problems.slice(0, 40)) console.log(`  - ${p.file}: ${p.problem}`);
    if (problems.length > 40) console.log(`  …（其余 ${problems.length - 40} 项略）`);
    process.exit(1);
  }
  console.log("[OK] 全部校验通过");
}

main();
