#!/usr/bin/env bun
/**
 * x-daily-trans-coverage — X 日报翻译覆盖率审计
 *
 * 背景：译文增量管道按「非中文正文」挑选待翻译条目，用词面写的是中文就算，于是
 * 日文/韩文被当成中文放过（2026-11-06 日报实证：一条日文 HTML-in-Canvas 推文没有
 * 译文，站内读者只能看假名原文）。本工具按渲染产物反查：日报里每条动态的语言、
 * 是否有译文，把「非中文却没译文」的条目点名。
 *
 * 用法：
 *   bun tools/2026-11-07-x-daily-trans-coverage/x-daily-trans-coverage.ts [--date 2026-11-06]
 *   bun tools/2026-11-07-x-daily-trans-coverage/x-daily-trans-coverage.ts --last 5
 *   bun tools/2026-11-07-x-daily-trans-coverage/x-daily-trans-coverage.ts --strict
 * 退出码：0 = 报告完成（--strict 且有缺口时 1）；2 = 参数/文件异常。纯本地只读。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const REPORTS = path.resolve(import.meta.dir, "..", "..", "reports", "daily");

interface Item {
  author: string;
  text: string;
  hasTrans: boolean;
  lang: "zh" | "ja" | "ko" | "en" | "other" | "url";
  gap: boolean;
}

const stripTags = (s: string): string =>
  s
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();

const count = (s: string, re: RegExp): number => (s.match(re) ?? []).length;

/** 语言判定：假名/谚文优先，再看拉丁字母与汉字的比例；纯链接视为无需翻译 */
function detectLang(text: string): Item["lang"] {
  const bare = text
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\b(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?:\/\S*)?/g, "")
    .trim();
  if (bare.length === 0) return "url";
  if (count(bare, /[\u3040-\u30ff]/g) > 0) return "ja";
  if (count(bare, /[\uac00-\ud7af]/g) > 0) return "ko";
  const han = count(bare, /[\u4e00-\u9fff]/g);
  const latinWords = count(bare, /\b[A-Za-z][A-Za-z'-]*\b/g);
  if (han === 0) return latinWords > 0 ? "en" : "other";
  if (han >= 4 && latinWords <= 4) return "zh";
  if (latinWords > han) return "en";
  return "zh";
}

function parseItems(html: string): Item[] {
  const items: Item[] = [];
  const chunks = html.split('class="x-arch-item"').slice(1);
  for (const chunk of chunks) {
    const author = stripTags(chunk.match(/class="x-arch-author"[^>]*>([^<]*)</)?.[1] ?? "?");
    const hasTrans = chunk.includes("x-arch-lang-switch") || chunk.includes("x-arch-trans");
    // 有译文时原文在 x-arch-orig，没译文时正文就是裸 x-arch-text
    const raw =
      chunk.match(/class="x-arch-text x-arch-orig">([\s\S]*?)<\/div>/)?.[1] ??
      chunk.match(/class="x-arch-text">([\s\S]*?)<\/div>/)?.[1] ??
      "";
    const text = stripTags(raw);
    const lang = detectLang(text);
    const gap = !hasTrans && (lang === "ja" || lang === "ko" || lang === "en");
    items.push({ author, text, hasTrans, lang, gap });
  }
  return items;
}

const LANG_LABEL: Record<Item["lang"], string> = {
  zh: "中",
  ja: "日",
  ko: "韩",
  en: "英",
  other: "其它",
  url: "链接",
};

function audit(file: string, strict: boolean): { gaps: number; items: number } {
  const html = readFileSync(file, "utf8");
  const items = parseItems(html);
  const gaps = items.filter((i) => i.gap);
  const withTrans = items.filter((i) => i.hasTrans).length;
  const name = path.basename(file);
  console.log(`${name}：${items.length} 条 · 有译文 ${withTrans} · 缺口 ${gaps.length}`);
  const byLang = new Map<Item["lang"], number>();
  for (const i of items) byLang.set(i.lang, (byLang.get(i.lang) ?? 0) + 1);
  console.log(
    `  语言分布：${[...byLang.entries()].map(([k, v]) => `${LANG_LABEL[k]} ${v}`).join(" / ")}`,
  );
  for (const g of gaps) {
    const preview = g.text.replace(/\s+/g, " ").slice(0, 64);
    console.log(`  ✗ ${LANG_LABEL[g.lang]} ${g.author}：${preview}${g.text.length > 64 ? "…" : ""}`);
  }
  if (gaps.length > 0) {
    console.log("  修法：bun scripts/x-translations-export.ts 手补该条译文后重渲染该日日报");
  }
  if (strict && gaps.length > 0) process.exitCode = 1;
  return { gaps: gaps.length, items: items.length };
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
  const all = readdirSync(REPORTS).filter((f) => /^\d{4}-\d{2}-\d{2}-x\.md$/.test(f)).sort();
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
    const n = lastIdx >= 0 ? Number(argv[lastIdx + 1]) || 5 : all.length;
    files = all.slice(-n).map((f) => path.join(REPORTS, f));
  }
  let totalGaps = 0;
  for (const f of files) totalGaps += audit(f, strict).gaps;
  console.log(
    `\n合计 ${files.length} 份日报，缺口 ${totalGaps} 条${totalGaps === 0 ? "（全部有译文）" : ""}`,
  );
  return strict && totalGaps > 0 ? 1 : 0;
}

process.exit(main());
