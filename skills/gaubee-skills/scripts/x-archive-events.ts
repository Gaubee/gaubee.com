#!/usr/bin/env bun
/**
 * x-archive-events.ts — X 动态历史按天归档成 events（kzf 2026-10-05 裁决）
 *
 * 文件意图（正交意图清单）：
 * - kzf：先利用 events 应用，结构化批量创建历史推文数据；同一天合并成同一个事件，
 *   没有动态的日期自然跳过；归档作用 + 站内搜索可被利用；Markdown 嵌套 HTML 自定义样式与交互。
 * - 1. x.json 按**本地时区日期**分组（created_at 是 UTC ISO，转本地日）
 * - 2. 跳过：无条目的日子；已有 signals-daily-<date> 日报覆盖的日期（避免与策展层重复）
 * - 3. 每天一个 event：000NN.x-archive-YYYY-MM-DD.md，tags [x-archive]，正文为 x-arch-* HTML 卡片
 * - 4. 幂等：已存在的同名 event 跳过（以文件为准，不覆盖手工编辑）
 *
 * 运行：bun scripts/x-archive-events.ts [--start 00026] [--dry]
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { sourceDir } from "./lib.ts";

const SRC = sourceDir("x-likes");
const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..");
const EVENTS_DIR = path.join(SITE, "src", "content", "events");

interface Tweet {
  id: string;
  text: string;
  created_at: string;
  kind: "posted" | "reposted" | "liked" | "bookmarked";
  author?: string;
  mediaLocal?: string[];
  videoLocal?: string[];
  posterLocal?: string;
}

const KIND_LABEL: Record<Tweet["kind"], string> = {
  liked: "赞",
  posted: "发",
  reposted: "转",
  bookmarked: "藏",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** UTC ISO → 本地时区 YYYY-MM-DD */
function localDateOf(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10);
}

function hhmm(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toTimeString().slice(0, 5);
}

/** 内容 tag 分类器（kzf 2026-10-05 裁决：归档基于内容加合理 tag）。
 *  按当日全部正文命中关键词计数，取最多的前 3 个；命中不足 1 次的规则不入选。 */
const TAG_RULES: [RegExp, string][] = [
  [/\b(rust|wasm|webassembly|zig|cargo|crab)\b|rust 代码|Rust 写/i, "rust"],
  [/\b(react|svelte|vue|frontend|front-end|css|tailwind|html|browser|web api|canvas)\b/i, "frontend"],
  [/\b(ai|llm|gpt|claude|gemini|agent|openai|anthropic|deepseek|moonbit|model|prompt|kimi|glm)\b|模型|智能体|大语言/i, "ai"],
  [/\b(database|postgres|mysql|sqlite|redis|sql|duckdb|存储)\b/i, "database"],
  [/\b(docker|kubernetes|k8s|self-?host|devops|deploy|server|nginx|vps)\b|自托管|部署/i, "devops"],
  [/\b(apple|ios|macos|swift|iphone|ipad|vision ?pro|airpods)\b|苹果/i, "apple"],
  [/\b(python|django|flask|pandas)\b/i, "python"],
  [/\b(game|gameplay|游戏|扫雷|roguelike|像素)\b/i, "game"],
  [/\b(design|动效|设计|typography|字体|icon|排版)\b/i, "design"],
  [/\b(security|加密|encrypt|cve|密码学)\b/i, "security"],
  [/\b(video|ffmpeg|player|播放器|视频)\b/i, "media"],
  [/\b(mcp|skill|coding agent|cli|terminal|终端)\b/i, "agent-tooling"],
];

function classifyTags(items: Tweet[]): string[] {
  const hits = new Map<string, number>();
  for (const t of items) {
    const text = `${t.text ?? ""}`;
    for (const [re, tag] of TAG_RULES) {
      const m = text.match(re);
      if (m) hits.set(tag, (hits.get(tag) ?? 0) + m.length);
    }
  }
  return [...hits.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([tag]) => tag);
}

interface AuthorInfo {
  name?: string;
  avatar?: string;
}

function itemCard(
  t: Tweet,
  authors: Record<string, AuthorInfo>,
  translations: Record<string, string>,
): string {
  const author = t.author || "gaubeebangeel";
  const statusUrl = `https://x.com/${author}/status/${t.id}`;
  const time = hhmm(t.created_at);
  const parts: string[] = [];
  const avatar = authors[author]?.avatar;
  const avatarImg = avatar
    ? `<img class="x-arch-avatar" src="${escapeHtml(avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
    : "";
  parts.push(
    `    <div class="x-arch-head">${avatarImg}<span class="x-arch-kind x-arch-kind-${t.kind}">${KIND_LABEL[t.kind]}</span>` +
      `<a class="x-arch-author" href="https://x.com/${author}" target="_blank" rel="nofollow noopener">@${escapeHtml(author)}</a>` +
      `<span class="x-arch-time">${time}</span>` +
      `<a class="x-arch-link" href="${statusUrl}" target="_blank" rel="noopener">原推文 ↗</a></div>`,
  );
  const text = escapeHtml((t.text ?? "").trim());
  const translation = translations[t.id];
  if (text && translation) {
    // 译文切换（kzf 2026-10-05 裁决：硬编码译文，CSS checkbox 切换原文/译文，零 JS）
    const safeId = `xl-${t.id}`;
    parts.push(
      `    <div class="x-arch-lang">` +
        `<input type="checkbox" id="${safeId}" class="x-arch-lang-input" aria-label="切换译文" />` +
        `<label for="${safeId}" class="x-arch-lang-switch"><span class="x-arch-lang-zh">译文</span><span class="x-arch-lang-orig">原文</span></label>` +
        `<div class="x-arch-text x-arch-orig">${text.replace(/\n/g, "<br />")}</div>` +
        `<div class="x-arch-text x-arch-trans">${escapeHtml(translation).replace(/\n/g, "<br />")}</div>` +
        `</div>`,
    );
  } else if (text) {
    parts.push(`    <div class="x-arch-text">${text.replace(/\n/g, "<br />")}</div>`);
  }
  const imgs = (t.mediaLocal ?? []).filter((p) => !p.endsWith(".mp4"));
  if (imgs.length) {
    parts.push(`    <div class="x-arch-media">`);
    for (const p of imgs) {
      parts.push(
        `      <a href="/${p}" target="_blank" rel="noopener"><img class="x-arch-img" src="/${p}" alt="推文配图" loading="lazy" /></a>`,
      );
    }
    parts.push(`    </div>`);
  }
  const video = (t.videoLocal ?? [])[0];
  if (video) {
    const poster = t.posterLocal ? ` poster="/${t.posterLocal}"` : "";
    parts.push(
      `    <video class="x-arch-video" preload="none" playsinline${poster} src="/${video}"></video>`,
    );
  }
  return `  <div class="x-arch-item">\n${parts.join("\n")}\n  </div>`;
}

async function main() {
  const argv = process.argv.slice(2);
  let startNum = 0;
  let dry = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--start") startNum = Number.parseInt(argv[++i] ?? "0", 10) || 0;
    else if (argv[i] === "--dry") dry = true;
  }

  const store: { items: Record<string, Tweet> } = JSON.parse(
    await Bun.file(path.join(SRC, "x.json")).text(),
  );

  // 作者头像（x-avatars.ts 产物，走外链）与硬编码译文（可渐进补充）
  const authorsFile = path.join(SRC, "authors.json");
  const authors: Record<string, AuthorInfo> = existsSync(authorsFile)
    ? JSON.parse(await Bun.file(authorsFile).text())
    : {};
  const translationsFile = path.resolve(import.meta.dir, "..", "translations", "x-tweets.zh.json");
  const translations: Record<string, string> = existsSync(translationsFile)
    ? JSON.parse(await Bun.file(translationsFile).text())
    : {};

  // 已有策展日报覆盖的日期归档跳过（避免与策展层重复）：
  // signals-daily-（旧混合报）、github-daily-（GitHub 日报，2026-10-05 拆分）、x-daily-（X 日报）
  const dailyCovered = new Set(
    readdirSync(EVENTS_DIR)
      .map((f) => f.match(/(?:signals-daily|github-daily|x-daily)-(\d{4}-\d{2}-\d{2})/)?.[1])
      .filter(Boolean) as string[],
  );

  // 现有最大编号
  let maxNum = 0;
  for (const f of readdirSync(EVENTS_DIR)) {
    const m = f.match(/^(\d{5})\./);
    if (m) maxNum = Math.max(maxNum, Number(m[1]));
  }
  let num = startNum || maxNum + 1;

  // 按本地日期分组
  const byDay = new Map<string, Tweet[]>();
  for (const t of Object.values(store.items)) {
    const day = localDateOf(t.created_at);
    if (!day) continue;
    const list = byDay.get(day) ?? [];
    list.push(t);
    byDay.set(day, list);
  }
  const days = [...byDay.keys()].filter((d) => !dailyCovered.has(d)).sort();
  console.error(
    `有动态的日期 ${byDay.size} 天；跳过日报已覆盖 ${dailyCovered.size} 天；待生成 ${days.length} 天（编号 ${String(num).padStart(5, "0")} 起）`,
  );

  let created = 0;
  let skipped = 0;
  for (const day of days) {
    const items = byDay.get(day)!.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    const file = path.join(EVENTS_DIR, `${String(num).padStart(5, "0")}.x-archive-${day}.md`);
    if (existsSync(file)) {
      skipped++;
      num++;
      continue;
    }
    const imgCount = items.reduce((n, t) => n + (t.mediaLocal ?? []).filter((p) => !p.endsWith(".mp4")).length, 0);
    const vidCount = items.reduce((n, t) => n + (t.videoLocal?.length ?? 0), 0);
    const contentTags = classifyTags(items);
    const tags = ["x-archive", ...contentTags];
    const cards = items.map((t) => itemCard(t, authors, translations)).join("\n");
    const body = [
      "---",
      `title: "X 归档 ${day}"`,
      `date: "${day}"`,
      "tags:",
      ...tags.map((t) => `  - ${t}`),
      "---",
      "",
      `<div class="x-arch-meta">${items.length} 条动态 · 图 ${imgCount} · 视频 ${vidCount}</div>`,
      `<div class="x-arch-day">`,
      cards,
      `</div>`,
      "",
    ].join("\n");
    if (dry) {
      console.log(`DRY ${path.basename(file)}（${items.length} 条）`);
    } else {
      await Bun.write(file, body);
    }
    created++;
    num++;
  }
  console.error(`${dry ? "DRY" : "生成"} ${created} 个归档 event${skipped ? `，跳过已存在 ${skipped}` : ""}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
