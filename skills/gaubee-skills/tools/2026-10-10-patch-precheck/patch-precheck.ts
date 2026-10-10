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
 * 退出码：0 = 所有有新增文件的月份组都安全；1 = 存在会撞名的组（清单见输出）。
 * 判定：staging/x 未入卷文件按月分组 → 今日卷名 patch-<月>-<DD>.tar 是否已被
 * 当前代 manifest 的 volumes[].name 引用。同名未被引用（崩溃残留）不算撞，
 * media-pack 会确定性重打包覆盖。
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

let collide = 0;
const lines: string[] = [];
for (const [month, files] of [...byMonth.entries()].sort()) {
  const name = `patch-${month}-${dd}.tar`;
  const hit = referencedNames.has(name);
  if (hit) collide++;
  lines.push(
    `${hit ? "✗ 撞名" : "✓ 安全"}  ${month}：${files.length} 个新文件 → ${name}` +
      (hit ? "（同名卷已被 manifest 引用，今日该组 --patch 将 fail-closed，建议改日）" : ""),
  );
}
console.log(`打包日 ${dd} 号 · 当前 manifest-${current.gen}（${manifest.volumes.length} 卷）`);
for (const l of lines) console.log(l);
console.log(collide === 0 ? "PRECHECK OK：全部月份组可安全 --patch" : `PRECHECK FAIL：${collide} 个月份组今日会撞名，建议改日或先入卷其它组`);
process.exit(collide === 0 ? 0 : 1);
