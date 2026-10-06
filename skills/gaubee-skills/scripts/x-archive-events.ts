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
import { existsSync, readdirSync, rmSync } from "node:fs";
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
void KIND_LABEL; // 语义备查：icon 版徽标的文字对照（KIND_META.label）

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

/** kind → 有色图标（lucide path，kzf 2026-10-05 裁决：icon 替代文字） */
const KIND_META: Record<Tweet["kind"], { label: string; paths: string[] }> = {
  liked: {
    label: "赞",
    paths: ["M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"],
  },
  posted: {
    label: "发",
    paths: ["M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z", "m15 5 4 4"],
  },
  reposted: {
    label: "转",
    paths: ["m17 2 4 4-4 4", "M3 11v-1a4 4 0 0 1 4-4h14", "m7 22-4-4 4-4", "M21 13v1a4 4 0 0 1-4 4H3"],
  },
  bookmarked: {
    label: "藏",
    paths: ["m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"],
  },
};

/** 正文富文本：``` 围栏转代码块（microlighter 高亮），URL 自动包裹成链接（kzf 裁决 12/13） */
function richText(raw: string): string {
  const parts: string[] = [];
  const fenceRe = /```(?:\w+)?\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(raw))) {
    if (m.index > last) parts.push(inlineText(raw.slice(last, m.index)));
    parts.push(`<pre class="x-arch-code" data-language="js"><code>${escapeHtml(m[1].replace(/\n$/, ""))}</code></pre>`);
    last = m.index + m[0].length;
  }
  if (last < raw.length) parts.push(inlineText(raw.slice(last)));
  return parts.join("\n");
}

function inlineText(s: string): string {
  const escaped = escapeHtml(s).replace(/\n/g, "<br />");
  return escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener">$1</a>',
  );
}

function itemCard(
  t: Tweet,
  authors: Record<string, AuthorInfo>,
  translations: Record<string, string>,
  mediaMeta: Record<string, { w: number; h: number; ms?: number }>,
): string {
  const author = t.author || "gaubeebangeel";
  const statusUrl = `https://x.com/${author}/status/${t.id}`;
  const time = hhmm(t.created_at);
  const parts: string[] = [];
  const avatar = authors[author]?.avatar;
  const avatarImg = avatar
    ? `<img class="x-arch-avatar" src="${escapeHtml(avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
    : "";
  const meta = KIND_META[t.kind];
  const kindIcon =
    `<span class="x-arch-kind x-arch-kind-${t.kind}" aria-label="${meta.label}" title="${meta.label}">` +
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    meta.paths.map((d) => `<path d="${d}" />`).join("") +
    `</svg></span>`;
  const translation = translations[t.id];
  // 译文切换（kzf 裁决 15 + 2026-10-06 走查）：双段 toggle 组（译|原），双 radio 零 JS，
  // 默认选中「译」；name 按推文 id 隔离，避免跨条目互斥
  const langInputs = translation
    ? `<input type="radio" name="xl-${t.id}" id="xl-${t.id}-zh" class="x-arch-lang-input x-arch-lang-input-zh" checked aria-label="显示译文" />` +
      `<input type="radio" name="xl-${t.id}" id="xl-${t.id}-orig" class="x-arch-lang-input x-arch-lang-input-orig" aria-label="显示原文" />`
    : "";
  const langSwitch = translation
    ? `<span class="x-arch-lang-switch" role="group" aria-label="切换原文/译文">` +
      `<label for="xl-${t.id}-zh" class="x-arch-lang-opt x-arch-lang-zh">译</label>` +
      `<label for="xl-${t.id}-orig" class="x-arch-lang-opt x-arch-lang-orig">原</label></span>`
    : "";
  parts.push(
    `    ${langInputs}<div class="x-arch-head">${avatarImg}${kindIcon}` +
      `<a class="x-arch-author" href="https://x.com/${author}" target="_blank" rel="nofollow noopener">@${escapeHtml(author)}</a>` +
      `<span class="x-arch-time">${time}</span>` +
      langSwitch +
      `<a class="x-arch-link" href="${statusUrl}" target="_blank" rel="noopener">原推文 ↗</a></div>`,
  );
  const origHtml = richText((t.text ?? "").trim());
  if (origHtml && translation) {
    parts.push(`    <div class="x-arch-text x-arch-orig">${origHtml}</div>`);
    parts.push(`    <div class="x-arch-text x-arch-trans">${richText(translation)}</div>`);
  } else if (origHtml) {
    parts.push(`    <div class="x-arch-text">${origHtml}</div>`);
  }
  const imgs = (t.mediaLocal ?? []).filter((p) => !p.endsWith(".mp4"));
  if (imgs.length) {
    parts.push(`    <div class="x-arch-media">`);
    for (let i = 0; i < imgs.length; i++) {
      const p = imgs[i]!;
      const size = mediaMeta[p];
      const dims = size ? ` width="${size.w}" height="${size.h}"` : "";
      parts.push(
        `      <a href="/${p}" target="_blank" rel="noopener"><img class="x-arch-img" src="/${p}" alt="@${escapeHtml(author)} 的配图 ${i + 1}/${imgs.length}" loading="lazy" decoding="async"${dims} /></a>`,
      );
    }
    parts.push(`    </div>`);
  }
  const video = (t.videoLocal ?? [])[0];
  if (video) {
    const poster = t.posterLocal ? ` poster="/${t.posterLocal}"` : "";
    const vsize = mediaMeta[video];
    const dims = vsize ? ` width="${vsize.w}" height="${vsize.h}" data-duration="${Math.round((vsize.ms ?? 0) / 1000)}"` : "";
    parts.push(
      `    <video class="x-arch-video" preload="none" playsinline${poster} src="/${video}"${dims} aria-label="@${escapeHtml(author)} 的视频"></video>`,
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
  // 媒体元数据（media-meta.ts 产物）：宽高挂进 HTML，布局稳定不跳动（kzf 裁决 16）
  const mediaMetaFile = path.join(SRC, "media-meta.json");
  const mediaMeta: Record<string, { w: number; h: number; ms?: number }> = existsSync(mediaMetaFile)
    ? JSON.parse(await Bun.file(mediaMetaFile).text())
    : {};

  // 已有策展日报覆盖的日期归档跳过（避免与策展层重复）：
  // signals-daily-（旧混合报）、github-daily-（GitHub 日报，2026-10-05 拆分）、x-daily-（X 日报）
  const dailyCovered = new Set(
    readdirSync(EVENTS_DIR)
      .map((f) => f.match(/(?:signals-daily|github-daily|x-daily)-(\d{4}-\d{2}-\d{2})/)?.[1])
      .filter(Boolean) as string[],
  );

  // 现有归档文件：day → 文件名（复用编号，保证同一日子永远只有一个文件）；
  // 以及全目录最大编号（新日子从这里续号）
  const existingByDay = new Map<string, string>();
  let maxNum = 0;
  for (const f of readdirSync(EVENTS_DIR)) {
    const dayMatch = f.match(/^(\d{5})\.x-archive-(\d{4}-\d{2}-\d{2})\.md$/);
    if (dayMatch) {
      const n = Number(dayMatch[1]);
      maxNum = Math.max(maxNum, n);
      const day = dayMatch[2];
      const prev = existingByDay.get(day);
      // 同日多文件（历史编号漂移残留）时保留最小编号，其余在重建后由调用方清理
      if (!prev || Number(prev.slice(0, 5)) > n) existingByDay.set(day, f);
    }
    const m = f.match(/^(\d{5})\./);
    if (m) maxNum = Math.max(maxNum, Number(m[1]));
  }
  const usedNums = new Set(readdirSync(EVENTS_DIR).map((f) => f.match(/^(\d{5})\./)?.[1]).filter(Boolean) as string[]);
  let nextFree = maxNum + 1;

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
    `有动态的日期 ${byDay.size} 天；跳过日报已覆盖 ${dailyCovered.size} 天；待生成 ${days.length} 天（新日子从 ${String(nextFree).padStart(5, "0")} 起续号）`,
  );

  let created = 0;
  let reused = 0;
  // 历史编号漂移产生的同日多余文件（保留最小编号那份，其余删除）
  for (const [day, kept] of existingByDay) {
    const keptNum = kept.slice(0, 5);
    for (const f of readdirSync(EVENTS_DIR)) {
      const m = f.match(/^(\d{5})\.x-archive-([\d-]+)\.md$/);
      if (m && m[2] === day && m[1] !== keptNum && !dry) {
        rmSync(path.join(EVENTS_DIR, f));
      }
    }
  }
  for (const day of days) {
    const items = byDay.get(day)!.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    // 复用既有编号（存在即强制重写，内容是派生数据）；新日子续号
    const existing = existingByDay.get(day);
    let numStr: string;
    if (existing) {
      numStr = existing.slice(0, 5);
      reused++;
    } else {
      while (usedNums.has(String(nextFree).padStart(5, "0"))) nextFree++;
      numStr = String(nextFree).padStart(5, "0");
      usedNums.add(numStr);
      nextFree++;
    }
    const file = path.join(EVENTS_DIR, `${numStr}.x-archive-${day}.md`);
    const imgCount = items.reduce((n, t) => n + (t.mediaLocal ?? []).filter((p) => !p.endsWith(".mp4")).length, 0);
    const vidCount = items.reduce((n, t) => n + (t.videoLocal?.length ?? 0), 0);
    const contentTags = classifyTags(items);
    const tags = ["x-archive", ...contentTags];
    const cards = items.map((t) => itemCard(t, authors, translations, mediaMeta)).join("\n");
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
  }
  console.error(`${dry ? "DRY" : "生成"} ${created} 个归档 event（复用编号 ${reused}）`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
