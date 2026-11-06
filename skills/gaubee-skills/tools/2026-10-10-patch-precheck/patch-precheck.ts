#!/usr/bin/env bun
/**
 * patch-precheck.ts — cdn-media 同日补丁卷闸门预检器（工具工坊 2026-10-10）
 *
 * 解决什么：media-pack --patch 的同名卷不可变闸门（A2）连续两天在 cron 里咬人
 * （10-09 撞 patch-2023-04-09、10-10 撞 patch-2026-10-10），每次都 fail-closed
 * 顺延且当天 X 日报被迫停发。本工具在 cron 第 4 步【前置】跑一次，提前告知
 * 今日各月份组能否安全 --patch，避免跑到一半才死。
 *
 * 怎么跑：bun tools/2026-10-10-patch-precheck/patch-precheck.ts [--date YYYY-MM-DD]
 *   --date 打包日（默认今天，本地时区），决定补丁卷名的 DD 段。
 * 退出码：0 = 无「同日同月」重复（跨月撞名会顺延 seq，不算失败）；1 = 存在同日同月重复组。
 * 判定：staging/x 未入卷文件按月分组 → 今日卷名 patch-<月>-<DD>.tar 是否已被
 * 当前代 manifest 的 volumes[].name 引用。同名未被引用（崩溃残留）不算撞，
 * media-pack 会确定性重打包覆盖。月份组不是打包月时（跨月回填），打包器顺延
 * seq 出全新卷，本工具报「跨月顺延」并给出实际卷名，不计入失败。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const dateArg = (() => {
  const i = argv.indexOf("--date");
  return i > -1 ? argv[i + 1] : undefined;
})();

const CDN = process.env.CDN_MEDIA_DIR
  ?? path.resolve(import.meta.dir, "..", "..", "..", "..", "cdn-media");

// 打包日（DD 段）
const now = dateArg ? new Date(`${dateArg}T12:00:00`) : new Date();
if (Number.isNaN(now.getTime())) {
  console.error(`非法 --date：${dateArg}`);
  process.exit(2);
}
const dd = String(now.getDate()).padStart(2, "0");
// 打包月（用于区分「同日同月重复」与「跨月回填撞名」）
const packingMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

// 当前代 manifest
const current = JSON.parse(readFileSync(path.join(CDN, "manifest", "current.json"), "utf8")) as {
  gen: number;
  manifest_path?: string;
};
const manifestFile = path.join(CDN, "manifest", `manifest-${current.gen}.json`);
const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as {
  objects: Record<string, unknown> | { key: string }[];
  volumes: { name: string }[];
};
// manifest-5 起 objects 是 {key,...} 数组（旧代为键值对象），两种形态都兼容
const known = new Set<string>(
  Array.isArray(manifest.objects) ? manifest.objects.map((o) => o.key) : Object.keys(manifest.objects),
);
const referencedNames = new Set(manifest.volumes.map((v) => v.name));

// staging 未入卷文件按月分组
const stagingX = path.join(CDN, "staging", "x");
if (!existsSync(stagingX)) {
  console.log("staging/x 不存在：无待打包文件，今日无需 --patch");
  process.exit(0);
}
const byMonth = new Map<string, string[]>();
for (const month of readdirSync(stagingX)) {
  const dir = path.join(stagingX, month);
  if (!/^\d{4}-\d{2}$/.test(month)) continue;
  for (const f of readdirSync(dir)) {
    const key = `x/${month}/${f}`;
    if (known.has(key)) continue;
    const list = byMonth.get(month) ?? [];
    list.push(f);
    byMonth.set(month, list);
  }
}

if (byMonth.size === 0) {
  console.log("staging 无新增（全部已入卷）：今日 --patch 会报「无新增」，安全跳过");
  process.exit(0);
}

/** 该月该日已存在的补丁卷里最大的 seq（无 seq 后缀的基名记为 1） */
function maxSeq(month: string, day: string): number {
  const base = `patch-${month}-${day}`;
  let max = 0;
  for (const v of manifest.volumes) {
    if (v.name === `${base}.tar`) max = Math.max(max, 1);
    const m = new RegExp(`^${base}-(\\d+)\\.tar$`).exec(v.name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

let collide = 0;
const lines: string[] = [];
for (const [month, files] of [...byMonth.entries()].sort()) {
  const name = `patch-${month}-${dd}.tar`;
  const hit = referencedNames.has(name);
  if (!hit) {
    lines.push(`✓ 安全  ${month}：${files.length} 个新文件 → ${name}`);
    continue;
  }
  if (month === packingMonth) {
    // 同日同月重复：打包器按设计 die
    collide++;
    lines.push(
      `✗ 同日同月撞名  ${month}：${files.length} 个新文件 → ${name}（当日该组已打过补丁，打包器拒绝，改日再打）`,
    );
  } else {
    // 跨月回填撞名：打包器顺延 seq 出全新卷，不覆盖、可打包
    lines.push(
      `~ 跨月顺延  ${month}：${files.length} 个新文件 → ${name} 已被占用，实际出 patch-${month}-${dd}-${maxSeq(month, dd) + 1}.tar（可打包）`,
    );
  }
}
console.log(`打包日 ${dd} 号 · 当前 manifest-${current.gen}（${manifest.volumes.length} 卷）`);
for (const l of lines) console.log(l);
console.log(
  collide === 0
    ? "PRECHECK OK：无同日同月重复，全部月份组可 --patch"
    : `PRECHECK FAIL：${collide} 个月份组今日同日同月重复，建议改日或先入卷其它组`,
);
process.exit(collide === 0 ? 0 : 1);
