#!/usr/bin/env bun
/**
 * media-meta.ts — 探测 x-media 媒体尺寸/时长，写 media-meta.json 供生成器布局用。
 *
 * [2026-10-05] kzf 裁决 16：视频/图片把宽高（视频含时长）挂进 HTML，列表布局稳定不跳动。
 * 视频：ffprobe（软依赖）；图片：bun 内解析 JPEG/PNG/WebP 头（零依赖、免 spawn）。
 * 产物：~/.gaubee-skills/data/sources/x-likes/media-meta.json（rel → { w, h, ms? }）
 *
 * 运行：bun scripts/media-meta.ts
 */
import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import path from "node:path";

import { sourceDir, writeFileAtomic } from "./lib.ts";

const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..");
const MEDIA_ROOT = path.join(SITE, "static", "x-media");
const OUT = path.join(sourceDir("x-likes"), "media-meta.json");

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
  const meta: Record<string, { w: number; h: number; ms?: number }> = existsSync(OUT)
    ? JSON.parse(await Bun.file(OUT).text())
    : {};

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
  if (existsSync(MEDIA_ROOT)) walk(MEDIA_ROOT);
  console.error(`待探测 ${files.length} 个文件（缓存 ${Object.keys(meta).length}）`);

  let done = 0;
  let videos = 0;
  for (const full of files) {
    const rel = path.relative(path.join(SITE, "static"), full);
    if (meta[rel]?.w) continue; // 已缓存
    if (full.endsWith(".mp4")) {
      const m = await videoMeta(full);
      if (m) {
        meta[rel] = m;
        videos++;
      }
    } else {
      const size = imageSize(full);
      if (size) meta[rel] = size;
    }
    done++;
    if (done % 300 === 0) {
      writeFileAtomic(OUT, JSON.stringify(meta, null, 1));
      console.error(`进度 ${done}/${files.length}（视频 ${videos}）`);
    }
  }
  writeFileAtomic(OUT, JSON.stringify(meta, null, 1));
  console.error(`完成：${Object.keys(meta).length} 条元数据（视频 ${videos}）`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
