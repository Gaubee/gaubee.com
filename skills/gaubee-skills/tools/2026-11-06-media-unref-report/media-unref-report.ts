#!/usr/bin/env bun
/**
 * media-unref-report — 已入卷但无人引用的媒体对象盘点
 *
 * 背景：x-media-audit 管「引用了但没入卷」（断链）与 staging 孤儿；反方向没人管——
 * 卷里入了 manifest、却没有任何页面/报告引用它的对象（典型来源：视频重做 HLS 后旧
 * mp4、封面重生成后旧 poster、改键后的历史残留）。这些对象占着远端存储，是 R2 水位
 * 决策要看的真实数字。
 *
 * 用法：
 *   bun tools/2026-11-06-media-unref-report/media-unref-report.ts [--top 10] [--json]
 * 退出码：0 = 正常（本工具只报告不判罚）；1 = 数据缺失。纯本地只读。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..", "..");
const CDN = process.env.CDN_MEDIA_DIR ?? path.join(SITE, "cdn-media");
const EVENTS = path.join(SITE, "src", "content", "events");

interface Obj {
  key: string;
  size: number;
}

function currentManifest(): { gen: number; objects: Obj[] } | null {
  const cur = path.join(CDN, "manifest", "current.json");
  if (!existsSync(cur)) return null;
  const pointer = JSON.parse(readFileSync(cur, "utf8")) as { gen: number; manifest?: string };
  const file = pointer.manifest
    ? path.join(CDN, "manifest", path.basename(pointer.manifest))
    : path.join(CDN, "manifest", `manifest-${pointer.gen}.json`);
  if (!existsSync(file)) return null;
  const mf = JSON.parse(readFileSync(file, "utf8")) as { objects: Obj[]; gen?: number };
  return { gen: mf.gen ?? pointer.gen, objects: mf.objects };
}

/** 站点内容里出现过的媒体键（src/href/裸路径都算） */
function referencedKeys(): Set<string> {
  const set = new Set<string>();
  if (!existsSync(EVENTS)) return set;
  const re = /cdn-media\/([^"'\s)>]+)/g;
  const add = (text: string) => {
    for (const m of text.matchAll(re)) {
      const key = m[1]!;
      const last = key.slice(key.lastIndexOf("/") + 1);
      if (!last.includes(".")) continue; // 排除正文里描述路径的片段
      set.add(key);
    }
  };
  for (const f of readdirSync(EVENTS)) {
    if (!f.endsWith(".md")) continue;
    add(readFileSync(path.join(EVENTS, f), "utf8"));
  }
  return set;
}

function main(): number {
  const argv = process.argv.slice(2);
  const topIdx = argv.indexOf("--top");
  const top = topIdx >= 0 ? Number(argv[topIdx + 1]) || 10 : 10;
  const asJson = argv.includes("--json");

  const mf = currentManifest();
  if (!mf) {
    console.error(`读不到 manifest（${path.join(CDN, "manifest")}）`);
    return 1;
  }
  const refs = referencedKeys();
  if (refs.size === 0) {
    console.error(`没有从 ${EVENTS} 抽到任何媒体引用（路径或内容异常）`);
    return 1;
  }

  // 引用是「含段」的：playlist 里的 .segNNNN.ts 由 playlist 隐式引用，
  // 故只要同 id 的 .m3u8 被引用，就视为该 id 的所有段都已引用
  const refIds = new Set<string>();
  for (const k of refs) {
    const m = k.match(/\/(\d{15,})[.\-]/);
    if (m) refIds.add(m[1]!);
  }

  const unref: Obj[] = [];
  for (const o of mf.objects) {
    if (refs.has(o.key)) continue;
    const m = o.key.match(/\/(\d{15,})[.\-]/);
    if (m && refIds.has(m[1]!)) continue; // 同 id 的 playlist 已被引用 → 段算已引用
    unref.push(o);
  }

  const total = mf.objects.reduce((s, o) => s + o.size, 0);
  const unrefBytes = unref.reduce((s, o) => s + o.size, 0);
  const byMonth = new Map<string, { n: number; bytes: number }>();
  for (const o of unref) {
    const mm = o.key.match(/^x\/(\d{4}-\d{2})\//);
    const k = mm?.[1] ?? "其它";
    const cur = byMonth.get(k) ?? { n: 0, bytes: 0 };
    cur.n++;
    cur.bytes += o.size;
    byMonth.set(k, cur);
  }

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          gen: mf.gen,
          objects: mf.objects.length,
          total_bytes: total,
          referenced_keys: refs.size,
          unref_objects: unref.length,
          unref_bytes: unrefBytes,
          by_month: Object.fromEntries([...byMonth.entries()].sort()),
        },
        null,
        2,
      ),
    );
    return 0;
  }

  console.log(
    `manifest gen ${mf.gen}：${mf.objects.length} 对象 / ${(total / 1024 ** 2).toFixed(1)} MB；站点引用键 ${refs.size} 个`,
  );
  console.log(
    `未被任何事件文件引用：${unref.length} 对象 / ${(unrefBytes / 1024 ** 2).toFixed(1)} MB（占总体积 ${((unrefBytes / total) * 100).toFixed(1)}%）`,
  );
  const months = [...byMonth.entries()].sort((a, b) => b[1].bytes - a[1].bytes);
  for (const [m, v] of months.slice(0, 8))
    console.log(`  ${m}  ${v.n} 个 / ${(v.bytes / 1024 ** 2).toFixed(1)} MB`);
  const biggest = [...unref].sort((a, b) => b.size - a.size).slice(0, top);
  if (biggest.length) {
    console.log(`最大的 ${biggest.length} 个：`);
    for (const o of biggest) console.log(`  ${(o.size / 1024 ** 2).toFixed(1)} MB  ${o.key}`);
  }
  console.log("说明：卷是 append-only，这些对象不会被删除；本报告只用于存储水位与 R2 决策");
  return 0;
}

process.exit(main());
