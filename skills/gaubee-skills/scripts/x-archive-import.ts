#!/usr/bin/env bun
/**
 * x-archive-import.ts — X Data Archive 历史回灌（source: x-likes）
 *
 * 文件意图（正交意图清单）：
 * - [2026-10-03] 原始需求（kzf）：免费拿到全量历史——官方 Data Archive（like.js/bookmark.js/tweet.js）回灌进 x.json 库存。
 * - 1. 解析归档 data/ 目录的 tweet.js（发帖，含全文）/ like.js（点赞，仅 id+时间）/ bookmark.js（收藏，仅 id+时间）
 * - 2. 合并进 data/sources/x-likes/x.json：不产生 changes（回灌是补历史，不是"新闻"）；已有富文本条目不被无文本的归档条目覆盖
 *
 * 用法：bun scripts/x-archive-import.ts <解压后的归档 data 目录>
 * 说明：X 归档申请入口 Settings → Your account → Download an archive of your data（几小时~一天就绪）。
 */
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import { localDate, sourceDir, writeFileAtomic } from "./lib.ts";

const SRC = sourceDir("x-likes");

/** X 归档的 .js 文件形如 `window.YTD.tweet.part0 = [ ... ];`——截出 JSON 数组 */
async function parseArchiveJs(file: string): Promise<any[]> {
  const raw = await Bun.file(file).text();
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end < 0) throw new Error(`${file} 不是可解析的归档 JS`);
  return JSON.parse(raw.slice(start, end + 1));
}

/** X 归档时间两种形态：旧 "Tue Oct 03 12:00:00 +0000 2023" / 新 ISO——统一转 ISO */
function toIso(s: string): string {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

async function main() {
  const dir = process.argv[2];
  if (!dir || !existsSync(dir)) {
    console.error("usage: x-archive-import.ts <解压后的归档 data 目录>");
    process.exit(2);
  }

  const storeFile = path.join(SRC, "x.json");
  if (!existsSync(storeFile)) {
    console.error("x.json 不存在——先跑一次 x-likes-fetch.ts 建立库存（含用户名），再回灌");
    process.exit(1);
  }
  const store = JSON.parse(await Bun.file(storeFile).text());
  if (!store.user.username) {
    console.error("x.json 缺 user.username——先跑一次 x-likes-fetch.ts");
    process.exit(1);
  }

  const stats = { tweet: 0, like: 0, bookmark: 0, skipped: 0 };
  const archiveDate = localDate();

  // 发帖（含全文；转发在归档里也是一条自己的 tweet，text 以 RT 开头）
  const tweetFile = path.join(dir, "tweet.js");
  if (existsSync(tweetFile)) {
    for (const e of await parseArchiveJs(tweetFile)) {
      const t = e.tweet ?? e;
      const id = t.id_str ?? t.id;
      if (!id) {
        stats.skipped++;
        continue;
      }
      const existing = store.items[id];
      if (existing && existing.text && existing.text !== "(archive)") {
        stats.skipped++;
        continue;
      }
      const fullText: string = t.full_text ?? t.text ?? "";
      store.items[id] = {
        id,
        text: fullText.slice(0, 120) || "(archive)",
        created_at: toIso(t.created_at ?? ""),
        kind: fullText.startsWith("RT @") ? "reposted" : "posted",
      };
      stats.tweet++;
    }
  }

  // 新版归档没有 tweet.js，只有 tweet-headers.js（仅 id+时间，无正文）——先收时间线，
  // 正文留待浏览器后端增量补全（2026-10-04 实测 kzf 档案即此形态，832 条）
  const tweetHeadersFile = path.join(dir, "tweet-headers.js");
  if (existsSync(tweetHeadersFile)) {
    for (const e of await parseArchiveJs(tweetHeadersFile)) {
      const t = e.tweet ?? e;
      const id = t.tweet_id ?? t.id_str ?? t.id;
      if (!id) {
        stats.skipped++;
        continue;
      }
      const existing = store.items[id];
      if (existing) {
        stats.skipped++;
        continue;
      }
      store.items[id] = {
        id,
        text: "(archive)",
        created_at: toIso(t.created_at ?? ""),
        kind: "posted",
      };
      stats.tweet++;
    }
  }

  // 点赞（只有 tweetId + 时间，文本留待浏览器增量补全）
  const likeFile = path.join(dir, "like.js");
  if (existsSync(likeFile)) {
    for (const e of await parseArchiveJs(likeFile)) {
      const like = e.like ?? e;
      const id = like.tweetId;
      if (!id) {
        stats.skipped++;
        continue;
      }
      const existing = store.items[id];
      // 点赞不会覆盖已有分类（同一条 tweet 已因发帖/收藏入库时保留原 kind）
      if (existing) {
        stats.skipped++;
        continue;
      }
      store.items[id] = {
        id,
        text: "(archive)",
        created_at: toIso(like.createdAt ?? ""),
        kind: "liked",
      };
      stats.like++;
    }
  }

  // 收藏（bookmarkId 可能与 tweetId 不同——X 收藏归档用自己的 bookmarkId，这里直接用其 id 存）
  const bookmarkFile = path.join(dir, "bookmark.js");
  if (existsSync(bookmarkFile)) {
    for (const e of await parseArchiveJs(bookmarkFile)) {
      const b = e.bookmark ?? e;
      const id = b.tweetId ?? b.bookmarkId;
      if (!id) {
        stats.skipped++;
        continue;
      }
      const existing = store.items[id];
      if (existing) {
        stats.skipped++;
        continue;
      }
      store.items[id] = {
        id,
        text: "(archive)",
        created_at: toIso(b.createdAt ?? ""),
        kind: "bookmarked",
      };
      stats.bookmark++;
    }
  }

  store.updated_at = new Date().toISOString();
  mkdirSync(SRC, { recursive: true });
  writeFileAtomic(storeFile, JSON.stringify(store, null, 1));
  console.log(
    `archive 回灌完成（${archiveDate}）：+tweet ${stats.tweet}、+like ${stats.like}、+bookmark ${stats.bookmark}，跳过已有 ${stats.skipped}，库存 ${Object.keys(store.items).length}`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
