#!/usr/bin/env bun
/**
 * migrate-time0.ts — x/1970-01 错月对象存量迁移（kzf 2026-10-09 time=0 修复，交付 4b/4c）
 *
 * 背景：x-posters.ts 旧月份兜底 `(t.created_at || "1970-01")` 把 created_at 尚缺的条目
 * 的 847 个媒体对象（838 poster + 9 图）打进了 `x/1970-01/` 错月 canonical key；
 * 条目真实时间事后由归档/syndication 富化补全，落盘键却不会回改。生成侧已修
 * （x-posters.ts 兜底改运行日），本工具做存量迁移（修在数据层优先）：
 *
 *   1. 读 current.json → manifest-<gen>.json，选中 `x/1970-01/` 前缀对象；
 *   2. 真实月份：tweet id 回查 x.json created_at，取 UTC 月 `created_at.slice(0,7)`
 *      （与既有正确键口径一致，抽样 12/12 验证）；个别仍缺时间者，回退扫
 *      src/content/events 的 `NNNNN.x-archive-YYYY-MM-DD.md` 文件名日期取月；
 *      仍不可得 → 任何写入前整体失败（fail-closed）；
 *   3. 目标键碰撞预检（先于任何写入）：目标键不得已在 manifest 中；staging 目标
 *      已存在时 sha256 必须与卷内字节一致（幂等续跑）；
 *   4. --write：按 manifest offset/size 从已发布卷（USTAR 512 对齐）提取字节，
 *      逐对象校验 sha256 后写入 staging 新键（append-only：旧卷旧对象一律不动）；
 *   5. --write 数据层引用同步（同一迁移单元）：
 *      - x.json：posterLocal/mediaLocal 的 `cdn-media/x/1970-01/` → 正确月键（writeFileAtomic，镜像 vault）；
 *      - media-meta.json：同键重映射（供 --patch 打包内嵌宽高；旧键保留无害，
 *        media-meta.ts 下次按 manifest 重建时自然收敛）；
 *   6. 迁移后由调用方执行：media-pack --patch → --publish（真实上传），见任务简报。
 *
 * 运行：bun tools/2026-10-09-x-time0-migration/migrate-time0.ts [--write]
 *   （默认 dry：只预检与报告，不写任何文件）
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { sourceDir, writeFileAtomic } from "../../scripts/lib.ts";

const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..", "..");
const MEDIA_REPO = path.join(SITE, "cdn-media");
const MANIFEST_DIR = path.join(MEDIA_REPO, "manifest");
const STAGING_X = path.join(MEDIA_REPO, "staging", "x");
const EVENTS_DIR = path.join(SITE, "src", "content", "events");
const SRC = sourceDir("x-likes");

interface ObjRec {
  key: string;
  volume: string;
  offset: number;
  size: number;
  sha256: string;
}
interface Manifest {
  gen: number;
  objects: ObjRec[];
  volumes: { name: string; size: number; sha256: string }[];
}

function die(msg: string): never {
  console.error(`[time0-migrate] FAIL ${msg}`);
  process.exit(1);
}

/** 文件名 → tweet id：`<id>-poster.jpg` 或 `<id>-<n>.<ext>` */
function tweetIdOf(filename: string): string {
  const m = /^(\d+)-poster\.jpg$/.exec(filename) ?? /^(\d+)-\d+\.[A-Za-z0-9]+$/.exec(filename);
  if (!m) die(`无法从对象文件名解析 tweet id: ${filename}`);
  return m[1]!;
}

async function main() {
  const write = process.argv.includes("--write");
  const t0 = Date.now();

  // 1) manifest 权威对象集
  const currentFile = path.join(MANIFEST_DIR, "current.json");
  if (!existsSync(currentFile)) die("current.json 不存在");
  const current = JSON.parse(readFileSync(currentFile, "utf8")) as { gen: number; manifest_sha256: string };
  const manifestFile = path.join(MANIFEST_DIR, `manifest-${current.gen}.json`);
  const mBytes = readFileSync(manifestFile);
  const mSha = new Bun.CryptoHasher("sha256").update(mBytes).digest("hex");
  if (mSha !== current.manifest_sha256) die(`manifest sha256 与 current.json 不一致`);
  const manifest = JSON.parse(mBytes.toString()) as Manifest;
  const targets = manifest.objects.filter((o) => o.key.startsWith("x/1970-01/"));
  const allKeys = new Set(manifest.objects.map((o) => o.key));
  console.error(`[time0-migrate] manifest gen ${current.gen}：共 ${manifest.objects.length} 对象，1970-01 错月 ${targets.length} 个`);
  if (targets.length === 0) {
    console.error("[time0-migrate] 无错月对象，无事可做");
    return;
  }

  // 2) 真实月份映射（x.json created_at UTC 月；回退归档事件文件名日期）
  const store = JSON.parse(readFileSync(path.join(SRC, "x.json"), "utf8")) as {
    items: Record<string, { id: string; created_at?: string; posterLocal?: string; mediaLocal?: string[] }>;
  };
  // 回退索引：tweet id → 归档事件日期（仅扫 x-archive 文件，正则取日期）
  const archiveDayOf = new Map<string, string>();
  if (existsSync(EVENTS_DIR)) {
    for (const f of readdirSync(EVENTS_DIR)) {
      const m = /^(\d{5})\.x-archive-(\d{4}-\d{2}-\d{2})\.md$/.exec(f);
      if (!m) continue;
      archiveDayOf.set(m[0], m[2]!); // 文件名 → 日期；按需 grep 内容太慢，先记文件集
    }
  }
  const plan: { obj: ObjRec; filename: string; tweetId: string; month: string; viaArchive: boolean }[] = [];
  const unknown: string[] = [];
  const needsFallback: { obj: ObjRec; filename: string; tweetId: string }[] = [];
  for (const obj of targets) {
    const filename = obj.key.split("/")[2]!;
    const tweetId = tweetIdOf(filename);
    const created = store.items[tweetId]?.created_at ?? "";
    if (/^\d{4}-\d{2}/.test(created)) {
      plan.push({ obj, filename, tweetId, month: created.slice(0, 7), viaArchive: false });
    } else {
      needsFallback.push({ obj, filename, tweetId });
    }
  }
  // 回退（仅在确有缺时间条目时才扫事件文件，一遍建索引）：tweet id → 归档事件日期
  if (needsFallback.length) {
    const dayById = new Map<string, string>();
    for (const [fname, day] of archiveDayOf) {
      const text = readFileSync(path.join(EVENTS_DIR, fname), "utf8");
      for (const fb of needsFallback) {
        if (!dayById.has(fb.tweetId) && (text.includes(`/${fb.tweetId}-`) || text.includes(`status/${fb.tweetId}`))) {
          dayById.set(fb.tweetId, day);
        }
      }
    }
    for (const fb of needsFallback) {
      const day = dayById.get(fb.tweetId);
      if (day) plan.push({ obj: fb.obj, filename: fb.filename, tweetId: fb.tweetId, month: day.slice(0, 7), viaArchive: true });
      else unknown.push(fb.obj.key);
    }
  }
  if (unknown.length) {
    die(`${unknown.length} 个对象既无 created_at 也无归档事件可回查（fail-closed，未写任何文件）:\n  ${unknown.slice(0, 10).join("\n  ")}`);
  }
  const byMonth = new Map<string, number>();
  let viaArchiveCount = 0;
  let totalBytes = 0;
  for (const p of plan) {
    byMonth.set(p.month, (byMonth.get(p.month) ?? 0) + 1);
    totalBytes += p.obj.size;
    if (p.viaArchive) viaArchiveCount++;
  }
  console.error(
    `[time0-migrate] 月份映射：${byMonth.size} 个月份组（${[...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([m, n]) => `${m}:${n}`).join(", ")}），共 ${(totalBytes / 1048576).toFixed(2)} MB，归档文件名回退 ${viaArchiveCount} 个`,
  );

  // 3) 碰撞预检（先于任何写入）
  const volNames = new Set(manifest.volumes.map((v) => v.name));
  const volPathCache = new Map<string, string>();
  for (const p of plan) {
    const targetKey = `x/${p.month}/${p.filename}`;
    if (targetKey === p.obj.key) die(`目标键与源键相同（月份映射异常）: ${targetKey}`);
    if (allKeys.has(targetKey)) die(`目标键已在 manifest 中（禁止覆盖，A2）: ${targetKey}`);
    const targetAbs = path.join(STAGING_X, p.month, p.filename);
    if (existsSync(targetAbs)) {
      const hasher = new Bun.CryptoHasher("sha256");
      hasher.update(readFileSync(targetAbs));
      if (hasher.digest("hex") !== p.obj.sha256) {
        die(`staging 目标已存在且内容不一致（需人工核查）: ${targetAbs}`);
      }
    }
    if (!volNames.has(p.obj.volume)) die(`对象卷不在 manifest: ${p.obj.volume}`);
    volPathCache.set(p.obj.volume, path.join(MEDIA_REPO, "staging", p.obj.volume));
  }

  // 4) 提取与写入（--write）
  if (!write) {
    console.error(`[time0-migrate] DRY 预检通过：${plan.length} 个对象将迁移，${(totalBytes / 1048576).toFixed(2)} MB。加 --write 执行提取与数据层引用更新`);
    return;
  }
  let extracted = 0;
  let skippedExisting = 0;
  let writtenBytes = 0;
  for (const p of plan) {
    const volPath = volPathCache.get(p.obj.volume)!;
    if (!existsSync(volPath)) die(`staging 卷缺失（本地权威副本不在）: ${volPath}`);
    const targetAbs = path.join(STAGING_X, p.month, p.filename);
    if (!existsSync(targetAbs)) {
      const bytes = new Uint8Array(await Bun.file(volPath).slice(p.obj.offset, p.obj.offset + p.obj.size).bytes());
      if (bytes.length !== p.obj.size) die(`提取字节数不符: ${p.obj.key} want=${p.obj.size} got=${bytes.length}`);
      const hasher = new Bun.CryptoHasher("sha256");
      hasher.update(bytes);
      if (hasher.digest("hex") !== p.obj.sha256) die(`提取 sha256 与 manifest 不符: ${p.obj.key}`);
      mkdirSync(path.dirname(targetAbs), { recursive: true });
      writeFileSync(targetAbs, bytes);
      extracted++;
      writtenBytes += bytes.length;
    } else {
      skippedExisting++; // 幂等续跑：预检已确认 sha 一致
    }
  }
  console.error(`[time0-migrate] 提取完成：新写 ${extracted} 个（${(writtenBytes / 1048576).toFixed(2)} MB），staging 已在（幂等跳过）${skippedExisting} 个`);

  // 5) 数据层引用同步：x.json posterLocal/mediaLocal + media-meta.json 键重映射
  let refsFixed = 0;
  for (const p of plan) {
    const entry = store.items[p.tweetId];
    if (!entry) continue;
    const oldKey = `cdn-media/${p.obj.key}`;
    const newKey = `cdn-media/x/${p.month}/${p.filename}`;
    if (entry.posterLocal === oldKey) {
      entry.posterLocal = newKey;
      refsFixed++;
    }
    if (Array.isArray(entry.mediaLocal)) {
      entry.mediaLocal = entry.mediaLocal.map((k) => (k === oldKey ? newKey : k));
    }
  }
  writeFileAtomic(path.join(SRC, "x.json"), JSON.stringify(store, null, 1));
  console.error(`[time0-migrate] x.json 引用更新：posterLocal ${refsFixed} 条，mediaLocal 随项替换（合计写回 ${Object.keys(store.items).length} 条库存）`);

  const metaFile = path.join(SRC, "media-meta.json");
  if (existsSync(metaFile)) {
    const meta = JSON.parse(readFileSync(metaFile, "utf8")) as Record<string, unknown>;
    let metaFixed = 0;
    for (const p of plan) {
      const oldKey = `cdn-media/${p.obj.key}`;
      const newKey = `cdn-media/x/${p.month}/${p.filename}`;
      if (meta[oldKey] !== undefined && meta[newKey] === undefined) {
        meta[newKey] = meta[oldKey];
        metaFixed++;
      }
    }
    writeFileAtomic(metaFile, JSON.stringify(meta, null, 1));
    console.error(`[time0-migrate] media-meta.json 键重映射：${metaFixed} 条（旧键保留，media-meta.ts 下次按 manifest 重建收敛）`);
  }

  console.error(`[time0-migrate] 完成（耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s）。下一步：cd cdn-media && bun tools/media-pack.ts --patch && bun tools/media-pack.ts --publish`);
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
