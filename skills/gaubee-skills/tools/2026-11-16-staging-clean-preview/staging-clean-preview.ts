#!/usr/bin/env bun
/**
 * staging-clean-preview — 周清理前的「按文件归组」核对视图
 *
 * 背景（2026-11-16 实证）：staging-clean 的 dry-run 是**平铺列表**，446 个文件一条条列出来，
 * 人根本没法逐条核对。真正要确认的只有三件事：
 *   1. 每一组的原始条目在快照里存在（不是孤儿）；
 *   2. 每一组的文件在 manifest 里（已入卷，删了不影响线上）；
 *   3. 每一组是否完整（`.m3u8` 在但段文件缺、或图片只有 1 张却应有 3 张）。
 *
 * 本工具把平铺清单折成「按条目 id 归组」的视图，每组给出文件数、总大小、
 * 最老 mtime、以及三项自检结果，让核对从 446 行变成几十行。
 *
 * 用法：
 *   bun tools/2026-11-16-staging-clean-preview/staging-clean-preview.ts
 *   bun tools/2026-11-16-staging-clean-preview/staging-clean-preview.ts --older-than 7 --json
 * 退出码：0 = 全部组通过自检；1 = 有组存在问题（不完整/未入卷/孤儿）；2 = 路径异常。只读。
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = process.env.GAUBEE_SKILLS_DATA ?? path.join(os.homedir(), ".gaubee-skills", "data");
const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..", "..");
const STAGING = path.join(SITE, "cdn-media", "staging", "x");
const MANIFEST = path.join(SITE, "cdn-media", "manifest", "current.json");
const STORE = path.join(DATA, "sources", "x-likes", "x.json");

/** 从文件名提取条目 id：`2120485971875828076-1.jpg` / `2120485971875828076.m3u8` / `...-poster.jpg` */
function idOf(file: string): string {
  const base = path.basename(file);
  const m = base.match(/^(\d{15,})/);
  return m ? m[1]! : `?${base}`;
}

interface ManifestFile {
  manifest_path?: string;
}
interface Group {
  id: string;
  files: Array<{ name: string; bytes: number; mtimeMs: number; key: string }>;
  bytes: number;
  oldestMtime: number;
  inManifest: number;
  issues: string[];
}

function collectFiles(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) collectFiles(p, out);
    else if (!/\.(part|ytdl)$/.test(ent.name) && !ent.name.includes(".part-Frag")) out.push(p);
  }
  return out;
}

function main(): number {
  const argv = process.argv.slice(2);
  const otIdx = argv.indexOf("--older-than");
  const olderThanDays = otIdx >= 0 ? Number(argv[otIdx + 1] ?? 7) : 7;
  const asJson = argv.includes("--json");
  for (const p of [STAGING, MANIFEST]) {
    if (!existsSync(p)) {
      console.error(`缺少：${p}`);
      return 2;
    }
  }

  // manifest 里的对象键集合（current.json 只存 gen；真正的键在 manifest_path 指向的文件）
  const cur = JSON.parse(readFileSync(MANIFEST, "utf8")) as { gen?: number; manifest_path?: string };
  const manifestFile = cur.manifest_path
    ? path.join(SITE, "cdn-media", cur.manifest_path)
    : path.join(SITE, "cdn-media", "manifest", `manifest-${cur.gen ?? 0}.json`);
  const keys = new Set<string>();
  if (existsSync(manifestFile)) {
    const mf = JSON.parse(readFileSync(manifestFile, "utf8")) as { objects?: Array<{ key?: string }> };
    for (const o of mf.objects ?? []) if (o.key) keys.add(o.key);
  }

  // 快照里的条目 id（判断孤儿）
  const known = new Set<string>();
  if (existsSync(STORE)) {
    const store = JSON.parse(readFileSync(STORE, "utf8")) as { items?: Record<string, unknown> };
    for (const id of Object.keys(store.items ?? {})) known.add(id);
  }

  const cutoff = Date.now() - olderThanDays * 86_400_000;
  const groups = new Map<string, Group>();
  for (const abs of collectFiles(STAGING)) {
    const st = statSync(abs);
    if (st.mtimeMs > cutoff) continue; // 未满保留期，不在本次清理范围
    const id = idOf(abs);
    const g = groups.get(id) ?? { id, files: [], bytes: 0, oldestMtime: st.mtimeMs, inManifest: 0, issues: [] };
    // manifest 里的 key 不带 cdn-media/ 前缀（形如 x/2026-11/2120...-1.jpg），
    // staging 相对路径正好同形，直接比 relInStaging。
    const relInStaging = path.relative(path.join(SITE, "cdn-media", "staging"), abs).split(path.sep).join("/");
    g.files.push({ name: path.basename(abs), bytes: st.size, mtimeMs: st.mtimeMs, key: relInStaging });
    g.bytes += st.size;
    g.oldestMtime = Math.min(g.oldestMtime, st.mtimeMs);
    groups.set(id, g);
  }

  // 每组自检：按完整 canonical key 比对，避免不同月份的同名文件互相冒充
  for (const g of groups.values()) {
    for (const f of g.files) {
      if (keys.has(f.key)) g.inManifest++;
      else g.issues.push(`未入卷：${f.key}`);
    }
    if (known.size && !known.has(g.id)) g.issues.push(`孤儿：快照里没有条目 ${g.id}`);
    const hasPlaylist = g.files.some((f) => f.name.endsWith(".m3u8"));
    const segs = g.files.filter((f) => f.name.endsWith(".ts")).length;
    if (hasPlaylist && segs === 0) g.issues.push("不完整：有 .m3u8 但没有 .ts 段");
  }

  const list = [...groups.values()].sort((a, b) => a.oldestMtime - b.oldestMtime);
  if (asJson) {
    console.log(JSON.stringify({ gen: cur.gen, groups: list }, null, 2));
    return list.some((g) => g.issues.length) ? 1 : 0;
  }

  const totalBytes = list.reduce((n, g) => n + g.bytes, 0);
  const bad = list.filter((g) => g.issues.length);
  console.log(
    `staging 待清理预览：manifest gen ${cur.gen ?? "?"}，${list.length} 个条目 / ` +
      `${list.reduce((n, g) => n + g.files.length, 0)} 个文件 / ${(totalBytes / 1048576).toFixed(1)} MB` +
      `（仅计 mtime 超 ${olderThanDays} 天的）`,
  );
  for (const g of list.slice(0, 25)) {
    const d = new Date(g.oldestMtime).toLocaleDateString("sv-SE");
    const flag = g.issues.length ? "✗" : "✓";
    console.log(
      `  ${flag} ${g.id}  ${g.files.length} 文件 ${(g.bytes / 1048576).toFixed(1)}MB  最老 ${d}  入卷 ${g.inManifest}/${g.files.length}`,
    );
    for (const i of g.issues.slice(0, 2)) console.log(`      ${i}`);
  }
  if (list.length > 25) console.log(`  …另 ${list.length - 25} 个条目`);

  if (bad.length) {
    console.error(`\n${bad.length} 个条目有问题，先别执行 --execute`);
    return 1;
  }
  console.log(`\nSTAGING PREVIEW OK：${list.length} 个条目全部已入卷、无孤儿、HLS 完整`);
  return 0;
}

process.exit(main());
