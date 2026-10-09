#!/usr/bin/env bun
/**
 * x-posters.ts — 视频推文封面下载 + 图片侧缺口补齐（syndication 公开接口）
 *
 * 文件意图（正交意图清单）：
 * - [2026-10-05] kzf 裁决：时间线/归档展示需要视频封面（卡片秒开，不加载视频元数据）；
 *   同时修复 14 条「视频+图片混合推文」的图片侧缺口（backfill 下载分支互斥导致封面被跳过）。
 * - 1. 有 videoLocal 无 posterLocal → 拉 syndication 取 poster（mediaDetails 的 video 条目图），落
 *      staging/x/YYYY-MM/<id>-poster.jpg，记 posterLocal（canonical media key cdn-media/x/…，
 *      Phase 3 起媒体不进 git，落点 = media-pack --source 的 staging 输入）
 * - 2. 有 media 无 mediaLocal → 直接下载图片（<id>-<n>.<ext>），记 mediaLocal（幂等补缺口）
 * - 3. 幂等可续跑：每 50 条落盘；网络失败不标记下次重试；429 退避
 * - 4. [2026-10-09 time=0 修复] 月份兜底从 "1970-01" 改为运行日本地日（与
 *      x-media-backfill 同约定），不再制造 1970-01 错月对象；存量迁移见
 *      tools/2026-10-09-x-time0-migration/
 *
 * 运行：bun scripts/x-posters.ts [--limit N]
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { localDate, sourceDir, writeFileAtomic } from "./lib.ts";

const SRC = sourceDir("x-likes");
const TOKEN = "gaubee-skills-x1";
const UA = "Mozilla/5.0 gaubee-skills";

interface Tweet {
  id: string;
  created_at: string;
  media?: string[];
  mediaLocal?: string[];
  videoLocal?: string[];
  posterLocal?: string;
  synChecked?: boolean;
}

interface XStore {
  updated_at: string;
  user: { id: string; username: string };
  items: Record<string, Tweet>;
}

async function fetchSyn(id: string): Promise<any | null | undefined> {
  const url = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=zh&token=${TOKEN}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.status === 429) {
        await Bun.sleep(15_000);
        continue;
      }
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
  return undefined;
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
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--limit") limit = Number.parseInt(argv[++i] ?? "0", 10) || Infinity;
  }

  const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..");
  const storeFile = path.join(SRC, "x.json");
  const store: XStore = JSON.parse(await Bun.file(storeFile).text());

  // 待处理：封面缺口 ∪ 图片缺口
  const todo = Object.values(store.items).filter(
    (t) => (t.videoLocal && !t.posterLocal) || ((t.media?.length ?? 0) > 0 && !t.mediaLocal?.length),
  );
  console.error(`待处理 ${todo.length} 条（封面 ${(todo.filter((t) => t.videoLocal && !t.posterLocal)).length}，图片缺口 ${(todo.filter((t) => (t.media?.length ?? 0) > 0 && !t.mediaLocal?.length)).length}）`);

  let bytes = 0;
  let files = 0;
  let done = 0;
  const stats = { poster: 0, img: 0, synFail: 0 };

  const save = () => {
    store.updated_at = new Date().toISOString();
    writeFileAtomic(storeFile, JSON.stringify(store, null, 1));
  };
  process.on("SIGINT", () => {
    console.error(`\n中断，进度已落盘（poster ${stats.poster} img ${stats.img}）`);
    save();
    process.exit(130);
  });

  for (const t of todo) {
    if (done >= limit) break;
    done++;
    // 月份兜底：created_at 缺失时用运行日本地日（与 x-media-backfill.ts 同约定）。
    // [2026-10-09 time=0 修复] 原兜底 "1970-01" 曾把 847 个对象（838 poster + 9 图）
    // 打进 x/1970-01/ 错月；该月永远是错的（created_at 事后由归档/syndication 富化补全，
    // 而落盘键不会回改），改运行日只作为「暂存桶」语义，不再制造 1970-01。
    const month = t.created_at ? t.created_at.slice(0, 7) : localDate();

    // 1) 封面：syndication 的 video 条目 media_url_https 即海报
    if (t.videoLocal && !t.posterLocal) {
      const syn = await fetchSyn(t.id);
      if (syn === undefined) {
        stats.synFail++;
        continue;
      }
      const detail = (syn?.mediaDetails ?? []).find((m: any) => m.type !== "photo" && m.media_url_https);
      let posterUrl: string | undefined = detail?.media_url_https;
      if (posterUrl && posterUrl.includes("/media/") && !posterUrl.includes("name=")) {
        posterUrl += "?name=large";
      }
      if (posterUrl) {
        try {
          const rel = `cdn-media/x/${month}/${t.id}-poster.jpg`;
          const abs = path.join(SITE, "cdn-media", "staging", "x", month, `${t.id}-poster.jpg`);
          if (!existsSync(abs)) {
            bytes += await download(posterUrl, abs);
            files++;
          }
          t.posterLocal = rel;
          stats.poster++;
        } catch (err) {
          console.error(`WARN poster ${t.id}: ${err instanceof Error ? err.message : err}`);
        }
      }
      await Bun.sleep(260);
    }

    // 2) 图片缺口（含 14 条视频+图片混合推文）
    if ((t.media?.length ?? 0) > 0 && !t.mediaLocal?.length) {
      const locals: string[] = [];
      for (let i = 0; i < t.media!.length; i++) {
        let url = t.media![i]!;
        if (url.includes("/media/") && !url.includes("name=")) url += "?name=large";
        const ext = url.match(/\.(\w{3,4})(?:\?|$)/)?.[1]?.toLowerCase() ?? "jpg";
        const rel = `cdn-media/x/${month}/${t.id}-${i + 1}.${ext}`;
        const abs = path.join(SITE, "cdn-media", "staging", "x", month, `${t.id}-${i + 1}.${ext}`);
        try {
          if (!existsSync(abs)) {
            bytes += await download(url, abs);
            files++;
          }
          locals.push(rel);
        } catch (err) {
          console.error(`WARN img ${t.id}-${i + 1}: ${err instanceof Error ? err.message : err}`);
        }
        await Bun.sleep(120);
      }
      if (locals.length) {
        t.mediaLocal = locals;
        stats.img++;
      }
    }

    if (done % 50 === 0) {
      save();
      console.error(`进度 ${done}/${todo.length}：封面 ${stats.poster} 图片条目 ${stats.img}，${files} 文件 ${(bytes / 1048576).toFixed(1)}MB`);
    }
  }

  save();
  console.error(
    `完成：封面 ${stats.poster} 条、图片条目 ${stats.img} 条，下载 ${files} 文件 ${(bytes / 1048576).toFixed(1)}MB，syn 失败 ${stats.synFail}（下次重试）`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
