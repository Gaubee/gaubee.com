#!/usr/bin/env bun
/**
 * x-daily-events.ts — X 日报卡片化生成器（kzf 2026-10-09 裁决：日报卡片化 b + 统一链路）
 *
 * 文件意图（正交意图清单）：
 * - [2026-10-09] X 内容管道统一：X 日报从「手写简报 + publish.ts 裸 markdown」切换为
 *   「与归档共用的 x-arch-* 卡片渲染」；本脚本按统一口径选条目、调共享渲染器出卡片。
 * - 归窗口径（kzf 2026-10-09 方案 a，与 tools/2026-10-09-x-window-entries 一致）：
 *   - liked/bookmarked：按「抓取差分」归窗——run-date（默认今天）的 changes/<run-date>.json
 *     added，经 html_url 的 status id 回查 x.json（X 不暴露点赞时刻，created_at 只能代位）；
 *   - posted/reposted：created_at 落 --date 本地日窗 [00:00, 24:00)（行为时间=推文发布时间）；
 *   - 两类合并按 created_at 排序、按 id 去重（同条既在差分又在时间窗只出一次）。
 * - 输出两处（内容一致，均含 frontmatter）：
 *   1. reports/daily/<date>-x.md（管道事实源，总是写）；
 *   2. src/content/events/NNNNN.x-daily-<date>.md——已存在时仅 --force 才重写（防误覆盖
 *      已发布 event）；新日期只写 reports，发布仍走 publish.ts。
 * - fail-closed：changes 文件缺失 → 退出 1；条目为 0 → 不产空日报，退出 1。
 *
 * 运行：bun scripts/x-daily-events.ts [--date YYYY-MM-DD] [--run-date YYYY-MM-DD] [--force] [--dry]
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { localDate, sourceDir } from "./lib.ts";
import { localDateOf, renderDayBody, type AuthorInfo, type MediaMeta, type Tweet } from "./lib/x-arch-render.ts";

const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..");
const EVENTS_DIR = path.join(SITE, "src", "content", "events");
// 事实源与事件文件分开落点：reports 跟 SITE 走（测试可用 GAUBEE_SITE 隔离），
// 生产环境 SITE = 仓库根，即 skills/gaubee-skills/reports/daily
const REPORTS_DIR = path.join(SITE, "skills", "gaubee-skills", "reports", "daily");

interface ChangesAdded {
  html_url?: string;
  full_name?: string;
  language?: string;
}

/** changes added 的 html_url → status id（与 x-window-entries 同一切法） */
function statusIdOf(htmlUrl: string): string {
  return htmlUrl.split("/status/")[1]?.split("?")[0] ?? "";
}

/** 统一口径选条目（导出供测试）：
 * - liked/bookmarked 走抓取差分；差分未覆盖的存量赞（changes 追踪基线 2026-10-04 之前
 *   入账，任何 changes 文件都没有它）回退 created_at 本地日窗——基线后每条赞都恰好出现
 *   在一个 changes 文件里，回退只命中存量，不会双重归属（2026-10-09 主线程裁定细则）；
 * - posted/reposted 走 created_at 时间窗（行为时间=推文发布时间）。 */
export function selectDailyEntries(
  items: Record<string, Tweet>,
  changesAdded: ChangesAdded[],
  date: string,
  allChangesIds?: Set<string>,
): { entries: Tweet[]; unresolved: number; fallbackIds: string[] } {
  // 1) 抓取差分：liked/bookmarked
  const diffIds: string[] = [];
  let unresolved = 0;
  for (const a of changesAdded) {
    const id = statusIdOf(a.html_url ?? "");
    if (!id) continue;
    if (items[id]) diffIds.push(id);
    else unresolved++;
  }
  // 2) 时间窗：posted/reposted 的 created_at 本地日 == date（与归档分组同一 localDateOf 口径）
  const windowIds = Object.values(items)
    .filter((t) => (t.kind === "posted" || t.kind === "reposted") && localDateOf(t.created_at) === date)
    .map((t) => t.id);
  // 2.5) 存量回退：liked/bookmarked 且不在任何 changes 差分、created_at 本地日 == date
  const fallbackIds: string[] = [];
  if (allChangesIds) {
    for (const t of Object.values(items)) {
      if (t.kind !== "liked" && t.kind !== "bookmarked") continue;
      if (allChangesIds.has(t.id)) continue;
      if (localDateOf(t.created_at) === date) fallbackIds.push(t.id);
    }
  }
  // 3) 合并去重（差分 > 回退 > 时间窗）+ 按 created_at 排序
  const seen = new Set<string>();
  const ordered: Tweet[] = [];
  for (const id of [...diffIds, ...fallbackIds, ...windowIds]) {
    if (seen.has(id)) continue;
    seen.add(id);
    const t = items[id];
    if (t) ordered.push(t);
  }
  ordered.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
  return { entries: ordered, unresolved, fallbackIds };
}

function eventFileFor(date: string): { num: string; abs: string } | null {
  if (!existsSync(EVENTS_DIR)) return null;
  for (const f of readdirSync(EVENTS_DIR)) {
    const m = f.match(/^(\d{5})\.x-daily-([\d-]+)\.md$/);
    if (m && m[2] === date) return { num: m[1], abs: path.join(EVENTS_DIR, f) };
  }
  return null;
}

async function main() {
  const argv = process.argv.slice(2);
  const argOf = (f: string): string | undefined => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const date = argOf("--date") ?? localDate(new Date(Date.now() - 86_400_000));
  const runDate = argOf("--run-date") ?? localDate();
  const force = argv.includes("--force");
  const dry = argv.includes("--dry");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}-\d{2}-\d{2}$/.test(runDate)) {
    console.error("用法: x-daily-events.ts [--date YYYY-MM-DD] [--run-date YYYY-MM-DD] [--force] [--dry]");
    process.exit(2);
  }

  const SRC = sourceDir("x-likes");
  const store: { items: Record<string, Tweet> } = JSON.parse(
    await Bun.file(path.join(SRC, "x.json")).text(),
  );

  const changesFile = path.join(SRC, "changes", `${runDate}.json`);
  if (!existsSync(changesFile)) {
    console.error(`FAIL 抓取差分不可用：${changesFile} 不存在（fail-closed，不生成日报）`);
    process.exit(1);
  }
  const changes = JSON.parse(await Bun.file(changesFile).text()) as { added?: ChangesAdded[] };

  // 全量 changes 索引（存量回退用：判断一条赞是否有差分记录）
  const changesDir = path.join(SRC, "changes");
  const allChangesIds = new Set<string>();
  for (const f of readdirSync(changesDir)) {
    if (!f.endsWith(".json")) continue;
    const c = JSON.parse(await Bun.file(path.join(changesDir, f)).text()) as { added?: ChangesAdded[] };
    for (const a of c.added ?? []) {
      const id = statusIdOf(a.html_url ?? "");
      if (id) allChangesIds.add(id);
    }
  }

  const authorsFile = path.join(SRC, "authors.json");
  const authors: Record<string, AuthorInfo> = existsSync(authorsFile)
    ? JSON.parse(await Bun.file(authorsFile).text())
    : {};
  const translationsFile = path.resolve(import.meta.dir, "..", "translations", "x-tweets.zh.json");
  const translations: Record<string, string> = existsSync(translationsFile)
    ? JSON.parse(await Bun.file(translationsFile).text())
    : {};
  const mediaMetaFile = path.join(SRC, "media-meta.json");
  const mediaMeta: MediaMeta = existsSync(mediaMetaFile)
    ? JSON.parse(await Bun.file(mediaMetaFile).text())
    : {};

  const { entries, unresolved, fallbackIds } = selectDailyEntries(store.items, changes.added ?? [], date, allChangesIds);
  console.error(
    `口径：date=${date} run-date=${runDate}；差分 added ${(changes.added ?? []).length}（回查未命中 ${unresolved}）；存量回退 ${fallbackIds.length}；选中 ${entries.length} 条`,
  );
  if (entries.length === 0) {
    console.error("FAIL 选中条目为 0——不生成空日报（fail-closed）");
    process.exit(1);
  }

  const body = renderDayBody(entries, { authors, translations, mediaMeta });
  // date 是发布事实，不随重渲染漂移（kzf 2026-10-10：--force 重写保留既有时间戳；
  // 实证 01811/01814/01816 曾被重渲染改到当天，页面发布时间全错）
  let dateIso = new Date().toISOString();
  const existingEvent = eventFileFor(date);
  if (existingEvent) {
    const m = readFileSync(existingEvent.abs, "utf8").match(/^date: "([^"]+)"/m);
    if (m?.[1]) dateIso = m[1];
  }
  const content = [
    "---",
    `title: "X 日报：${date}"`,
    `date: "${dateIso}"`,
    "tags:",
    "  - event",
    "  - signals",
    "  - x",
    "---",
    "",
    body,
    "",
  ].join("\n");

  if (dry) {
    console.log(`DRY ${path.join(REPORTS_DIR, `${date}-x.md`)}（${entries.length} 条）`);
    const ev = eventFileFor(date);
    console.log(ev ? `DRY 事件文件 ${path.basename(ev.abs)} 存在，${force ? "--force 将重写" : "未加 --force 不重写"}` : "DRY 事件文件不存在（新日期只写 reports）");
    return;
  }

  mkdirSync(REPORTS_DIR, { recursive: true });
  const reportFile = path.join(REPORTS_DIR, `${date}-x.md`);
  writeFileSync(reportFile, content);
  console.error(`已写 ${path.relative(process.cwd(), reportFile)}（${entries.length} 条）`);

  const ev = eventFileFor(date);
  if (ev) {
    if (force) {
      writeFileSync(ev.abs, content);
      console.error(`已重写事件文件 ${path.basename(ev.abs)}（--force）`);
    } else {
      console.error(`跳过事件文件 ${path.basename(ev.abs)}（已存在；重写需 --force）`);
    }
  } else {
    console.error("事件文件不存在（新日期只写 reports，发布走 publish.ts）");
  }
}

// import.meta.main 守卫：测试可 import selectDailyEntries 纯函数而不触发 CLI
if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
