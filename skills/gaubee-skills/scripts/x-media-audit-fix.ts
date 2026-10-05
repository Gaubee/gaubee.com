#!/usr/bin/env bun
/**
 * x-media-audit-fix.ts — 媒体引用体检：库存声明的 mediaLocal/videoLocal/posterLocal
 * 与磁盘实际文件对账；缺失的尝试从库存 URL 重下载，仍失败则剥除引用（消灭 404）。
 *
 * 运行：bun scripts/x-media-audit-fix.ts
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { sourceDir, writeFileAtomic } from "./lib.ts";

const SRC = sourceDir("x-likes");
const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..");
const UA = "Mozilla/5.0 gaubee-skills";

interface Tweet {
  id: string;
  author?: string;
  created_at: string;
  media?: string[];
  video?: string[];
  mediaLocal?: string[];
  videoLocal?: string[];
  posterLocal?: string;
}

async function download(url: string, abs: string): Promise<boolean> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) return false;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length < 2000) return false;
    await Bun.write(abs, buf);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const storeFile = path.join(SRC, "x.json");
  const store: { items: Record<string, Tweet> } = JSON.parse(await Bun.file(storeFile).text());

  let missing = 0;
  let redownloaded = 0;
  let stripped = 0;

  for (const t of Object.values(store.items)) {
    const month = (t.created_at || "1970-01").slice(0, 7);

    // 图片引用对账
    if (t.mediaLocal?.length) {
      const kept: string[] = [];
      for (let i = 0; i < t.mediaLocal.length; i++) {
        const rel = t.mediaLocal[i]!;
        const abs = path.join(SITE, "static", rel);
        if (existsSync(abs)) {
          kept.push(rel);
          continue;
        }
        missing++;
        const url = t.media?.[i];
        if (url && (await download(url, abs))) {
          kept.push(rel);
          redownloaded++;
        } else {
          stripped++;
        }
      }
      t.mediaLocal = kept.length ? kept : undefined;
    }

    // 视频对账
    if (t.videoLocal?.length) {
      const kept: string[] = [];
      for (const rel of t.videoLocal) {
        const abs = path.join(SITE, "static", rel);
        if (existsSync(abs)) {
          kept.push(rel);
          continue;
        }
        missing++;
        const url = t.video?.[0];
        if (url && (await download(url, abs.replace(/\.mp4$/, ".mp4")))) {
          kept.push(rel);
          redownloaded++;
        } else {
          stripped++;
        }
      }
      t.videoLocal = kept.length ? kept : undefined;
    }

    // 封面对账（缺失直接剥除，不阻塞视频）
    if (t.posterLocal && !existsSync(path.join(SITE, "static", t.posterLocal))) {
      missing++;
      t.posterLocal = undefined;
      stripped++;
    }
  }

  writeFileAtomic(storeFile, JSON.stringify(store, null, 1));
  console.error(
    `对账完成：缺失引用 ${missing}，重下载成功 ${redownloaded}，剥除 ${stripped}（死链已消灭）`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
