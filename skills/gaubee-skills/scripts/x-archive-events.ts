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
 * - [2026-10-09] 渲染层抽出到 lib/x-arch-render.ts（X 内容管道统一，日报卡片化共用），
 *   本文件只保留分组/编号/落盘编排，渲染行为零变化。
 *
 * 运行：bun scripts/x-archive-events.ts [--start 00026] [--dry]
 */
import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

import { sourceDir } from "./lib.ts";
import { classifyTags, localDateOf, renderDayBody, type AuthorInfo, type MediaMeta, type Tweet } from "./lib/x-arch-render.ts";

const SRC = sourceDir("x-likes");
const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..");
const EVENTS_DIR = path.join(SITE, "src", "content", "events");

const KIND_LABEL: Record<Tweet["kind"], string> = {
  liked: "赞",
  posted: "发",
  reposted: "转",
  bookmarked: "藏",
};
void KIND_LABEL; // 语义备查：icon 版徽标的文字对照（KIND_META.label）

async function main() {
  const argv = process.argv.slice(2);
  let startNum = 0;
  let dry = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--start") startNum = Number.parseInt(argv[++i] ?? "0", 10) || 0;
    else if (argv[i] === "--dry") dry = true;
  }
  void startNum; // 历史参数：曾用于指定起始编号，现编号完全由既有文件决定

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
  // 媒体元数据（media-meta.ts 产物：manifest w/h/ms + staging 兜底，键 = canonical
  // media key）：宽高挂进 HTML，布局稳定不跳动（kzf 裁决 16）
  const mediaMetaFile = path.join(SRC, "media-meta.json");
  const mediaMeta: MediaMeta = existsSync(mediaMetaFile)
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
    const contentTags = classifyTags(items);
    const tags = ["x-archive", ...contentTags];
    const body = [
      "---",
      `title: "X 归档 ${day}"`,
      `date: "${day}"`,
      "tags:",
      ...tags.map((t) => `  - ${t}`),
      "---",
      "",
      renderDayBody(items, { authors, translations, mediaMeta }),
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
