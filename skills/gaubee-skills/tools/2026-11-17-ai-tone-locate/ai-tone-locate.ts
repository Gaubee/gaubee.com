#!/usr/bin/env bun
/**
 * ai-tone-locate — 把 ai-tone 的「密度超标」落到具体句子
 *
 * 背景（2026-11-17 实证）：ai-tone-metrics 报 2026-11-16 日报「顿号罗列≥3 5.69/0.7k RED」，
 * 但它是按文件算**密度**的，不告诉你哪几句贡献了这些顿号。人只能肉眼扫全文找并列结构。
 * 那天实际有 4 处并列（星标改名说明、spool 性能账、chmod 说明、管道汇总），
 * 逐条改完才清零——这个「找句子」的过程完全可以自动化。
 *
 * 做法：复用 ai-tone-metrics.mjs 的同一套正则（通过 --dump-regex 让它导出，或内置同款），
 * 对每个命中指标逐句列出命中的原文，按句号/分号切分，标出行号。
 *
 * 本工具只做定位，不改文件、不做判定。判定仍以 ai-tone-metrics 的退出码为准。
 *
 * 用法：
 *   bun tools/2026-11-17-ai-tone-locate/ai-tone-locate.ts reports/daily/2026-11-16.md
 *   bun tools/2026-11-17-ai-tone-locate/ai-tone-locate.ts reports/daily/2026-11-16.md --only 顿号罗列≥3
 * 退出码：0 = 有命中并已列出；1 = 无命中；2 = 用法/文件错误。只读。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** 与 scripts/ai-tone-metrics.mjs 同款的高频特征正则（只收录能按句定位的几项）。
 *  阈值不在这里判——判定权归 ai-tone-metrics，避免两处阈值漂移。 */
const PATTERNS: Array<{ id: string; re: RegExp; hint: string }> = [
  {
    id: "顿号罗列≥3",
    re: /[^，。；：！？\n]{1,20}、[^，。；：！？\n]{1,20}、[^，。；：！？\n]{1,20}/g,
    hint: "三个以上顿号并列。改成短句、或只留两个、或用分号分层",
  },
  {
    id: "破折号——",
    re: /——/g,
    hint: "破折号会显得像解释腔。换成冒号、句号断开，或直接删",
  },
  {
    id: "提示语冒号",
    re: /(如下|以下|包括|例如|比如)：/g,
    hint: "「提示语 + 冒号 + 列表」是 AI 典型结构。改成直接陈述",
  },
  {
    id: "这意味着复述",
    re: /(这意味着|这表示|也就是说|换句话说)/g,
    hint: "复述上一句。删掉整句",
  },
  {
    id: "句首连接词",
    re: /^[^。\n]{0,4}(然而|此外|另外|同时|因此|所以|不过)[，,]/gm,
    hint: "句首连接词。多数可删，中文不靠连接词也能承接",
  },
  {
    id: "禁用起手式",
    re: /^(首先|其次|最后|综上|总的来说)[，,]/gm,
    hint: "模板化起手式。删掉直接说事",
  },
];

/** 按中文句子切分（保留行号），用于把命中归到句 */
function sentences(text: string): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = [];
  const lines = text.split("\n");
  let inFrontmatter = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed === "---") {
      inFrontmatter = !inFrontmatter;
      continue;
    }
    if (inFrontmatter) continue;
    if (!trimmed) continue;
    // HTML 卡片与 JSON 片段跳过：那些是结构不是行文。
    // 注意不要过滤 `- ` 开头的列表项——正文的提交段全是列表，过滤掉就什么都扫不到
    // （2026-11-17 首版踩过：19 句只剩 0 句）。
    if (/^</.test(trimmed) || /^[{"]/.test(trimmed)) continue;
    // markdown 标题行只保留文字部分
    const body = trimmed.replace(/^#+\s*/, "").replace(/^[-*]\s+/, "");
    // 跳过「仓库清单」型列表项：形如 `- [owner/name](url) — 说明`。
    // ai-tone-metrics 的顿号预算主要针对行文，把星标条目的顿号算进来会虚高
    // （2026-11-17 实测：11-15 报告本身已达标，本工具却报了 2 句）。
    if (/^-?\s*\[[^\]]+\]\(https?:\/\//.test(trimmed)) continue;
    for (const s of body.split(/(?<=[。！？；])/)) {
      const t = s.trim();
      if (t.length > 3) out.push({ line: i + 1, text: t });
    }
  }
  return out;
}

function main(): number {
  const argv = process.argv.slice(2);
  const target = argv.find((a) => !a.startsWith("--"));
  const oi = argv.indexOf("--only");
  const only = oi >= 0 ? argv[oi + 1] : "";
  if (!target) {
    console.error("用法：ai-tone-locate.ts <报告文件> [--only <指标名>]");
    return 2;
  }
  const abs = path.resolve(process.cwd(), target);
  if (!existsSync(abs)) {
    console.error(`文件不存在：${abs}`);
    return 2;
  }
  const text = readFileSync(abs, "utf8");
  const sents = sentences(text);

  const wanted = only ? PATTERNS.filter((p) => p.id.includes(only)) : PATTERNS;
  if (wanted.length === 0) {
    console.error(`没有匹配的指标：${only}`);
    return 2;
  }

  let total = 0;
  console.log(`${path.basename(abs)}：逐句定位（${sents.length} 句扫描）`);
  for (const p of wanted) {
    const hits: Array<{ line: number; text: string; count: number }> = [];
    for (const s of sents) {
      const m = s.text.match(p.re);
      if (m && m.length > 0) hits.push({ ...s, count: m.length });
    }
    if (hits.length === 0) continue;
    total += hits.length;
    console.log(`\n【${p.id}】${hits.length} 句命中 —— ${p.hint}`);
    for (const h of hits) {
      const trimmed = h.text.length > 90 ? `${h.text.slice(0, 88)}…` : h.text;
      console.log(`  L${h.line}  ×${h.count}  ${trimmed}`);
    }
  }

  if (total === 0) {
    console.log("\nAI-TONE LOCATE：没有命中任何可定位特征（密度超标可能全由重复小词累积，需看 ai-tone-metrics 原表）");
    return 1;
  }
  console.log(`\n共 ${total} 句需要改。改完重跑 ai-tone-metrics 确认 RED 清零。`);
  return 0;
}

process.exit(main());
