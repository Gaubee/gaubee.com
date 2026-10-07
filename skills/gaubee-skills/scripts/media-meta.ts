#!/usr/bin/env bun
/**
 * media-meta.ts — 媒体尺寸/时长元数据，写 media-meta.json 供生成器布局用。
 *
 * [2026-10-05] kzf 裁决 16：视频/图片把宽高（视频含时长）挂进 HTML，列表布局稳定不跳动。
 * [2026-10-07 cdn-media Phase 3（plan 3.3）] 输入源切换：
 * - 权威来源 = cdn-media/manifest/manifest-<gen>.json（A1 打包时 ffprobe 已内嵌
 *   width/height/duration_ms，本地不再需要视频文件即可产出全量元数据）；
 * - 增量来源 = cdn-media/staging/x/<月>/<文件>（已下载未打包的新文件，ffprobe/图片头
 *   解析兜底；下次 media-pack 打包后自动进 manifest，本脚本重跑即收敛）。
 * 产出格式不变：~/.gaubee-skills/data/sources/x-likes/media-meta.json，键从旧
 * `x-media/<月>/<文件>` 冻结为 canonical media key `cdn-media/x/<月>/<文件>`（与
 * x.json mediaLocal/videoLocal/posterLocal 同键空间，Phase 3 前缀迁移一次性完成）。
 *
 * 运行：bun scripts/media-meta.ts
 */
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import path from "node:path";

import { sourceDir, writeFileAtomic } from "./lib.ts";

const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..");
const MEDIA_REPO = path.join(SITE, "cdn-media");
const MANIFEST_DIR = path.join(MEDIA_REPO, "manifest");
const STAGING_X = path.join(MEDIA_REPO, "staging", "x");
const OUT = path.join(sourceDir("x-likes"), "media-meta.json");

/** manifest 权威源：current.json → manifest-<gen>.json（本地仓库副本，零网络）。
 *  返回 canonical 元数据键（cdn-media/x/<月>/<文件>）→ { w, h, ms? }。 */
async function metaFromManifest(): Promise<Record<string, { w: number; h: number; ms?: number }>> {
  const currentFile = path.join(MANIFEST_DIR, "current.json");
  if (!existsSync(currentFile)) return {};
  const current = JSON.parse(await Bun.file(currentFile).text());
  const gen = current.gen;
  if (typeof gen !== "number") throw new Error("current.json 缺 gen 字段（损坏？）");
  const manifestFile = path.join(MANIFEST_DIR, `manifest-${gen}.json`);
  if (!existsSync(manifestFile)) throw new Error(`manifest-${gen}.json 不存在（指针与清单失配）`);
  const manifest = JSON.parse(await Bun.file(manifestFile).text());
  const out: Record<string, { w: number; h: number; ms?: number }> = {};
  for (const o of manifest.objects ?? []) {
    if (typeof o.key !== "string" || typeof o.width !== "number" || typeof o.height !== "number")
      continue; // 无尺寸的对象（打包时不可得）按缺省处理，生成器回退无尺寸输出
    const entry: { w: number; h: number; ms?: number } = { w: o.width, h: o.height };
    if (typeof o.duration_ms === "number") entry.ms = o.duration_ms;
    out[`cdn-media/${o.key}`] = entry;
  }
  return out;
}

function pngSize(buf: Uint8Array): { w: number; h: number } | null {
  if (buf.length < 24) return null;
  const w = (buf[16]! << 24) | (buf[17]! << 16) | (buf[18]! << 8) | buf[19]!;
  const h = (buf[20]! << 24) | (buf[21]! << 16) | (buf[22]! << 8) | buf[23]!;
  return w > 0 && h > 0 ? { w, h } : null;
}

function jpegSize(buf: Uint8Array): { w: number; h: number } | null {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1]!;
    // SOF0/1/2/3/5/6/7/9/10/11/13/14/15 携带尺寸
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const h = (buf[i + 5]! << 8) | buf[i + 6]!;
      const w = (buf[i + 7]! << 8) | buf[i + 8]!;
      return w > 0 && h > 0 ? { w, h } : null;
    }
    const len = (buf[i + 2]! << 8) | buf[i + 3]!;
    i += 2 + len;
  }
  return null;
}

function webpSize(buf: Uint8Array): { w: number; h: number } | null {
  if (buf.length < 30) return null;
  const fourcc = String.fromCharCode(buf[12]!, buf[13]!, buf[14]!, buf[15]!);
  const u16 = (i: number) => buf[i]! | (buf[i + 1]! << 8);
  const u24 = (i: number) => buf[i]! | (buf[i + 1]! << 8) | (buf[i + 2]! << 16);
  if (fourcc === "VP8X") {
    const w = 1 + u24(24);
    const h = 1 + u24(27);
    return { w, h };
  }
  if (fourcc === "VP8 ") {
    return { w: u16(26) & 0x3fff, h: u16(28) & 0x3fff };
  }
  if (fourcc === "VP8L") {
    const b = buf[21]! | (buf[22]! << 8) | (buf[23]! << 16) | (buf[24]! << 24);
    return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
  }
  return null;
}

function imageSize(file: string): { w: number; h: number } | null {
  const buf = readHead(file);
  if (!buf) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50) return pngSize(buf);
  if (buf[0] === 0xff && buf[1] === 0xd8) return jpegSize(buf);
  if (String.fromCharCode(buf[0]!, buf[1]!, buf[2]!, buf[3]!) === "RIFF") return webpSize(buf);
  return null;
}

const HEAD_MAX = 256 * 1024;
function readHead(file: string): Uint8Array | null {
  try {
    const size = statSync(file).size;
    if (!size) return null;
    const len = Math.min(size, HEAD_MAX);
    const buf = new Uint8Array(len);
    const fd = openSync(file, "r");
    try {
      readSync(fd, buf, 0, len, 0);
    } finally {
      closeSync(fd);
    }
    return buf;
  } catch {
    return null;
  }
}

async function videoMeta(file: string): Promise<{ w: number; h: number; ms: number } | null> {
  try {
    const out = Bun.spawnSync(
      ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", file],
      { stdout: "pipe", stderr: "ignore" },
    );
    const d = JSON.parse(new TextDecoder().decode(out.stdout));
    const stream = d.streams?.[0];
    const ms = Math.round(Number(d.format?.duration ?? 0) * 1000);
    if (stream?.width && stream?.height) return { w: stream.width, h: stream.height, ms };
  } catch {
    /* ffprobe 不可用 */
  }
  return null;
}

async function main() {
  // 1) 权威源：manifest 内嵌元数据（3426 对象全带 w/h，Phase 3 起不再依赖本地视频文件）
  const meta = await metaFromManifest();
  const fromManifest = Object.keys(meta).length;
  console.error(`manifest 权威元数据 ${fromManifest} 条`);

  // 2) 增量源：staging 新文件（canonical key 布局 staging/x/<月>/<文件>），探测兜底
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (!name.includes(".")) {
        walk(full);
        continue;
      }
      files.push(full);
    }
  };
  if (existsSync(STAGING_X)) walk(STAGING_X);

  let probed = 0;
  let videos = 0;
  for (const full of files) {
    const rel = path.relative(STAGING_X, full); // <月>/<文件>（扫描根 = staging/x）
    const key = `cdn-media/x/${rel}`; // canonical media key = cdn-media/x/<月>/<文件>
    if (meta[key]?.w) continue; // manifest 已收录（待 7 天保留期清理的 staging 残留）
    if (full.endsWith(".mp4")) {
      const m = await videoMeta(full);
      if (m) {
        meta[key] = m;
        videos++;
      }
    } else {
      const size = imageSize(full);
      if (size) meta[key] = size;
    }
    probed++;
  }

  writeFileAtomic(OUT, JSON.stringify(meta, null, 1));
  console.error(
    `完成：${Object.keys(meta).length} 条元数据（manifest ${fromManifest} + staging 新探测 ${probed}，其中视频 ${videos}）`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
