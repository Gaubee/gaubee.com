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

function itemCard(t: Tweet): string {
  const author = t.author || "gaubeebangeel";
  const statusUrl = `https://x.com/${author}/status/${t.id}`;
  const time = hhmm(t.created_at);
  const parts: string[] = [];
  parts.push(
    `    <div class="x-arch-head"><span class="x-arch-kind x-arch-kind-${t.kind}">${KIND_LABEL[t.kind]}</span>` +
      `<a class="x-arch-author" href="https://x.com/${author}" rel="nofollow noopener">@${escapeHtml(author)}</a>` +
      `<span class="x-arch-time">${time}</span>` +
      `<a class="x-arch-link" href="${statusUrl}" rel="nofollow noopener">原推文 ↗</a></div>`,
  );
  const text = escapeHtml((t.text ?? "").trim());
  if (text) parts.push(`    <div class="x-arch-text">${text.replace(/\n/g, "<br />")}</div>`);
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
      `    <video class="x-arch-video" controls preload="none"${poster} src="/${video}"></video>`,
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
    const cards = items.map(itemCard).join("\n");
    const body = [
      "---",
      `title: "X 归档 ${day}"`,
      `date: "${day}"`,
      "tags:",
      "  - x-archive",
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
