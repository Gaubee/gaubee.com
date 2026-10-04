#!/usr/bin/env bun
/**
 * x-media-backfill.ts — 历史 X 动态的正文/媒体回灌（syndication 公开接口，免登录）
 *
 * 文件意图（正交意图清单）：
 * - [2026-10-05] kzf：动态 event 要图文视频齐全、墙内可读；时间线抽取只能覆盖近期窗口，
 *   历史条目靠 syndication tweet-result 逐条补：正文全文 + 图片 + mp4 变体直链（免 yt-dlp）。
 * - 1. 遍历库存中无 synChecked 标记的条目，拉 syndication 富化（text/media/video/author/时间）
 * - 2. 媒体落 SITE/static/x-media/YYYY-MM/（图片 name=large；视频挑 ≤720p mp4 变体）
 * - 3. 幂等可续跑：每 50 条落盘一次（writeFileAtomic 镜像进 vault）；已处理条目标记 synChecked
 * - 4. 体积护栏：累计媒体体积超 --max-gb（默认 4.5）即停下载、只留元数据，报告提示外置存储
 *
 * 运行：bun scripts/x-media-backfill.ts [--limit N] [--no-download] [--max-gb 4.5]
 * 前置：~/.gaubee-skills/data/sources/x-likes/x.json 已由 x-archive-import / x-likes-fetch 建立
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { localDate, sourceDir, writeFileAtomic } from "./lib.ts";

const SRC = sourceDir("x-likes");
// token 参数必填但值任意（实测空值返回空对象）；固定一个随机串即可
const TOKEN = "gaubee-skills-x1";
const UA = "Mozilla/5.0 gaubee-skills";

interface Tweet {
  id: string;
  text: string;
  created_at: string;
  kind: "posted" | "reposted" | "liked" | "bookmarked";
  author?: string;
  media?: string[];
  video?: string[];
  hasVideo?: boolean;
  mediaLocal?: string[];
  videoLocal?: string[];
  synChecked?: boolean; // syndication 回灌已处理（无论成败，防重跑）
}

interface XStore {
  updated_at: string;
  user: { id: string; username: string };
  cursors: Record<string, unknown>;
  items: Record<string, Tweet>;
}

interface SynMedia {
  media_url_https?: string;
  type?: string;
  video_info?: { variants?: { content_type?: string; url: string }[] };
}

function pickMp4(videoInfo: SynMedia["video_info"]): string | null {
  const mp4 = (videoInfo?.variants ?? []).filter((v) => v.content_type === "video/mp4");
  if (!mp4.length) return null;
  const withH = mp4.map((v) => ({
    url: v.url,
    h: Number(v.url.match(/\/(\d+)x(\d+)\//)?.[2] ?? 0),
  }));
  const fit = withH.filter((v) => v.h > 0 && v.h <= 720);
  const pool = fit.length ? fit : withH;
  return pool.sort((a, b) => b.h - a.h)[0]!.url;
}

async function fetchSyn(id: string): Promise<any | null> {
  const url = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=zh&token=${TOKEN}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.status === 429) {
        await Bun.sleep(15_000);
        continue;
      }
      if (res.status === 404) return null; // 删除/不可见，永久性
      if (!res.ok) {
        await Bun.sleep(2_000);
        continue;
      }
      const data = (await res.json()) as any;
      return data?.id_str ? data : null;
    } catch {
      await Bun.sleep(3_000);
    }
  }
  return undefined; // 网络性失败：不标记，下次重试
}

/** 清理推文正文：t.co 链接换成真实 URL，媒体占位链接直接删除 */
function cleanText(text: string, entities: any): string {
  let out = text;
  for (const u of entities?.urls ?? []) {
    if (u.url && u.expanded_url) out = out.replaceAll(u.url, u.expanded_url);
  }
  for (const m of entities?.media ?? []) {
    if (m.url) out = out.replaceAll(m.url, "");
  }
  return out.trim();
}

async function download(url: string, abs: string): Promise<number> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length < 2000) throw new Error(`too small (${buf.length}B)`);
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, buf);
  return buf.length;
}

async function main() {
  const argv = process.argv.slice(2);
  let limit = Infinity;
  let noDownload = false;
  let maxGb = 4.5;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--limit") limit = Number.parseInt(argv[++i] ?? "0", 10) || Infinity;
    else if (argv[i] === "--no-download") noDownload = true;
    else if (argv[i] === "--max-gb") maxGb = Number.parseFloat(argv[++i] ?? "4.5") || 4.5;
  }

  const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..");
  const storeFile = path.join(SRC, "x.json");
  if (!existsSync(storeFile)) {
    console.error("x.json 不存在（先跑 x-archive-import.ts / x-likes-fetch.ts）");
    process.exit(2);
  }
  const store: XStore = JSON.parse(await Bun.file(storeFile).text());
  const todo = Object.values(store.items).filter((t) => !t.synChecked);
  console.error(`待回灌 ${todo.length} 条（库存 ${Object.keys(store.items).length}）`);

  const maxBytes = maxGb * 1024 ** 3;
  let bytes = 0;
  let dlFiles = 0;
  let guardTripped = false;
  const stats = { ok: 0, unavailable: 0, netFail: 0, text: 0, mediaTweets: 0, videoTweets: 0 };

  const save = () => {
    store.updated_at = new Date().toISOString();
    writeFileAtomic(storeFile, JSON.stringify(store, null, 1));
  };

  const shutdown = () => {
    console.error(`\n中断：已处理进度已落盘（ok=${stats.ok} unavailable=${stats.unavailable}）`);
    save();
    process.exit(130);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  let processed = 0;
  for (const t of todo) {
    if (processed >= limit) break;
    processed++;

    const syn = await fetchSyn(t.id);
    if (syn === undefined) {
      stats.netFail++;
      continue; // 不标记，下次重试
    }
    if (syn === null) {
      t.synChecked = true;
      stats.unavailable++;
      continue;
    }

    // 正文富化：占位/空直接替换；已有则取更长版本（syndication 全文 vs DOM 截断）
    const text = cleanText(String(syn.text ?? ""), syn.entities);
    if (text && (t.text === "(archive)" || t.text === "" || text.length > t.text.length)) {
      if (text !== t.text) stats.text++;
      t.text = text;
    }
    if (!t.author && syn.user?.screen_name) t.author = syn.user.screen_name;

    // 媒体元数据（URL 会被签名过期影响，回灌时以 syndication 新鲜值为准）
    const details: SynMedia[] = syn.mediaDetails ?? [];
    const photos = details.filter((m) => m.type === "photo" && m.media_url_https);
    const videos = details.filter((m) => m.type === "video" || m.type === "animated_gif");
    if (photos.length) t.media = photos.map((m) => m.media_url_https!);
    const mp4 = pickMp4(videos[0]?.video_info);
    if (mp4) {
      t.video = [mp4];
      t.hasVideo = true;
    } else if (videos.length) {
      t.hasVideo = true;
    }
    if (photos.length || videos.length) stats.mediaTweets++;
    if (videos.length) stats.videoTweets++;

    // 媒体下载（图片 name=large；视频挑好的 ≤720p 变体；防护栏）
    const month = (t.created_at || localDate()).slice(0, 7);
    if (!noDownload && !guardTripped && (t.media?.length || t.video?.length)) {
      try {
        if (t.video?.length && !t.videoLocal) {
          const rel = `x-media/${month}/${t.id}-video.mp4`;
          const abs = path.join(SITE, "static", rel);
          if (existsSync(abs)) {
            t.videoLocal = [rel];
          } else {
            const size = await download(t.video[0]!, abs);
            bytes += size;
            dlFiles++;
            t.videoLocal = [rel];
          }
        }
        if (!t.video?.length && t.media?.length && !t.mediaLocal?.length) {
          const locals: string[] = [];
          for (let i = 0; i < t.media.length; i++) {
            let url = t.media[i]!;
            if (url.includes("/media/") && !url.includes("name=")) url += "?name=large";
            const ext = url.match(/\.(\w{3,4})(?:\?|$)/)?.[1]?.toLowerCase() ?? "jpg";
            const rel = `x-media/${month}/${t.id}-${i + 1}.${ext}`;
            const abs = path.join(SITE, "static", rel);
            if (!existsSync(abs)) {
              const size = await download(url, abs);
              bytes += size;
              dlFiles++;
            }
            locals.push(rel);
          }
          t.mediaLocal = locals;
        }
        if (bytes > maxBytes) {
          guardTripped = true;
          console.error(`\n体积护栏触发（${(bytes / 1024 ** 3).toFixed(2)} GB > ${maxGb} GB）：停止下载，只留元数据`);
        }
      } catch (err) {
        console.error(`WARN media ${t.id}: ${err instanceof Error ? err.message : err}`);
      }
    }

    t.synChecked = true;
    stats.ok++;

    if (stats.ok % 50 === 0) {
      save();
      console.error(
        `进度 ${stats.ok}/${todo.length}：正文+${stats.text} 媒体+${stats.mediaTweets} 视频+${stats.videoTweets} 下载 ${dlFiles} 文件 ${(bytes / 1024 / 1024).toFixed(1)}MB`,
      );
    }
    await Bun.sleep(280); // 公共接口限速礼貌：约 3.5 QPS 以下
  }

  save();
  console.error(
    `完成：ok=${stats.ok} 不可用=${stats.unavailable} 网络失败=${stats.netFail}（下次重试）\n` +
      `富化：正文 ${stats.text} 条、媒体推文 ${stats.mediaTweets}、含视频 ${stats.videoTweets}\n` +
      `下载：${dlFiles} 文件 ${(bytes / 1024 / 1024).toFixed(1)} MB${guardTripped ? `（护栏 ${maxGb}GB 触发，历史剩余未下载）` : ""}`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
