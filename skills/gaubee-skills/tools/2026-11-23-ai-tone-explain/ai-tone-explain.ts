#!/usr/bin/env bun
/**
 * ai-tone-explain — 给出某个指标「到底匹配了什么」，并标出疑似误报
 *
 * 背景（2026-11-23 实证）：ai-tone-metrics 报「比喻(明喻) 2 / budget 1 RED」，
 * 我在译文里把「图片模型」写成了「图像模型」——`图像` 里的「像」加上后面的「一样」，
 * 正好命中 /（像|…）[^。]{2,24}(一样|…)/ 这条明喻正则。它其实是个复合词的一部分，
 * 不是比喻。ai-tone-locate 只覆盖顿号/破折号/提示语几项，不含比喻，所以当时只能靠猜。
 *
 * 本工具做两件事：
 *   1. 打印每个命中的**原文片段**（前后各带一点上下文），让人一眼看出匹配到了什么；
 *   2. 对疑似误报打标记：命中起点落在 `图像 / 录像 / 影像 / 肖像 / 偶像 / 想象 / 好像 / 相像`
 *      这类含「像」的复合词里时，几乎都不是比喻。
 *
 * 只读，不改文件、不改 metrics 的判定口径——阈值与归属仍以 ai-tone-metrics 为准。
 *
 * 用法：
 *   bun tools/2026-11-23-ai-tone-explain/ai-tone-explain.ts reports/daily/2026-11-22-x.md --metric 比喻
 *   bun tools/2026-11-23-ai-tone-explain/ai-tone-explain.ts <文件>            # 列出全部命中
 * 退出码：0 = 有命中并已解释；1 = 该指标无命中；2 = 用法错误。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** 与 scripts/ai-tone-metrics.mjs 同源的正则（只收可解释的几项，阈值不复制） */
const PATTERNS: Array<{ id: string; re: RegExp }> = [
  {
    id: "比喻(明喻)",
    re: /(像|如同|好比|犹如|宛如)[^。，；]{2,24}(一样|一般|那样|一样地)|像(一位|一个|一名|一场|一局)[^，。；]{2,16}/g,
  },
  {
    id: "比喻(行文隐喻)",
    re: /主菜|前菜|加餐|赌注|筹码|同船|另一翼|接缝|护城河|拼图|游戏房间|登船|压舱石/g,
  },
  { id: "顿号罗列≥3", re: /[^，。；：！？\n]{1,20}、[^，。；：！？\n]{1,20}、[^，。；：！？\n]{1,20}/g },
  { id: "破折号——", re: /——/g },
  { id: "提示语冒号", re: /(如下|以下|包括|例如|比如)：/g },
  { id: "这意味着复述", re: /(这意味着|这表示|也就是说|换句话说)/g },
];

/** 含「像」但不是比喻的复合词（命中起点落在这些词里 → 疑似误报） */
const COMPOUND_WITH_XIANG = ["图像", "录像", "影像", "肖像", "偶像", "想象", "好像", "相像", "像素", "雕像", "镜像"];

interface Hit {
  metric: string;
  line: number;
  span: string;
  context: string;
  suspect: boolean;
  reason?: string;
}

/** 去掉 frontmatter 与 HTML 卡片，只留行文（与 ai-tone-metrics 的扫描对象一致） */
function proseLines(text: string): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = [];
  let inFm = false;
  text.split("\n").forEach((line, i) => {
    const t = line.trim();
    if (t === "---") {
      inFm = !inFm;
      return;
    }
    if (inFm || !t) return;
    if (/^</.test(t) || /^[{"]/.test(t)) return;
    out.push({ line: i + 1, text: line });
  });
  return out;
}

function classify(span: string, full: string, matchIndex: number): { suspect: boolean; reason?: string } {
  // 命中片段以「像」开头时，检查它是不是某个含「像」的复合词的一部分
  const before = full.slice(Math.max(0, matchIndex - 2), matchIndex);
  for (const w of COMPOUND_WITH_XIANG) {
    const idx = w.indexOf("像");
    if (idx < 0) continue;
    // 复合词以「像」结尾（图像/录像/影像/肖像/偶像/想象/相像）：看命中起点前是否正好接上它的前半段
    if (idx === w.length - 1 && before === w.slice(0, idx)) {
      return { suspect: true, reason: `命中起点落在复合词「${w}」里的「像」，不是比喻` };
    }
  }
  if (/^(像|如同|好比|犹如|宛如)/.test(span) && !/[一-龥]{2,}/.test(span.slice(1, 3))) {
    return { suspect: true, reason: "「像」后没有实词搭配，多半是断句或复合词残留" };
  }
  return { suspect: false };
}

function main(): number {
  const argv = process.argv.slice(2);
  const target = argv.find((a) => !a.startsWith("--"));
  const mi = argv.indexOf("--metric");
  const metricFilter = mi >= 0 ? argv[mi + 1] : undefined;
  if (!target) {
    console.error("用法：ai-tone-explain.ts <文件> [--metric <指标名子串>]");
    return 2;
  }
  const abs = path.resolve(process.cwd(), target);
  if (!existsSync(abs)) {
    console.error(`文件不存在：${abs}`);
    return 2;
  }
  const lines = proseLines(readFileSync(abs, "utf8"));
  const patterns = metricFilter ? PATTERNS.filter((p) => p.id.includes(metricFilter)) : PATTERNS;
  if (patterns.length === 0) {
    console.error(`没有匹配的指标：${metricFilter}`);
    return 2;
  }

  const hits: Hit[] = [];
  for (const p of patterns) {
    for (const l of lines) {
      for (const m of l.text.matchAll(p.re)) {
        const span = m[0];
        const at = m.index ?? 0;
        const { suspect, reason } = classify(span, l.text, at);
        const ctx = `${l.text.slice(Math.max(0, at - 8), at)}【${span}】${l.text.slice(at + span.length, at + span.length + 8)}`;
        hits.push({ metric: p.id, line: l.line, span, context: ctx.replace(/\s+/g, " "), suspect, reason });
      }
    }
  }

  console.log(`${path.basename(abs)}：${lines.length} 行行文，命中 ${hits.length} 处`);
  if (hits.length === 0) {
    console.log("AI-TONE EXPLAIN：该指标没有命中（密度超标可能来自别处）");
    return 1;
  }
  const suspects = hits.filter((h) => h.suspect);
  for (const h of hits) {
    const tag = h.suspect ? "△ 疑似误报" : "✗ 需改";
    console.log(`\n[${tag}] ${h.metric}  L${h.line}`);
    console.log(`    …${h.context}…`);
    if (h.reason) console.log(`    ${h.reason}`);
  }
  console.log(
    `\n其中 ${suspects.length} 处疑似误报、${hits.length - suspects.length} 处需要改。` +
      (suspects.length ? "误报的改写法即可（换同义词），不必推翻整句。" : ""),
  );
  return 0;
}

process.exit(main());
