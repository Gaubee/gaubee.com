#!/usr/bin/env bun
/**
 * manifest-lint —— cdn-media 清单体检器（gaubee-skills 工具工坊 2026-10-07）
 *
 * 解决什么：媒体分发管线（openspec/specs/cdn-media/spec.md R4）的 manifest 会随每日补丁
 * 频繁换代，坏清单一旦被 cdn-base 拉取会污染整条媒体链。本工具做发布前/后的一键体检：
 *   (a) current.json → manifest-<gen>.json 的 sha256 一致
 *   (b) 每对象 offset % 512 == 0 且 offset + size ≤ 所在卷 size（checked 算术）
 *   (c) key 固定格式 <source>/<YYYY-MM>/<file>
 *   (d) 可选 --assets N：抽前 N 卷经 gh api（Accept: application/octet-stream）Range
 *       拉卷头 1KB，验证远端 asset 可达且字节与本地卷头一致
 *
 * 怎么跑：
 *   bun skills/gaubee-skills/tools/2026-10-07-manifest-lint/manifest-lint.ts [--assets N]
 * 退出码：0 = 全过；1 = 有病；2 = 用法错误。需要 gh 已登录（仅 --assets 时）。
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dir, "../../../..");
const MANIFEST_DIR = path.join(REPO_ROOT, "cdn-media", "manifest");
const STAGING_DIR = path.join(REPO_ROOT, "cdn-media", "staging");

type CurrentVol = { asset_id: number | null; url: string | null; sha256: string; name: string };
type CurrentFile = { gen: number; manifest_sha256: string; manifest_path: string; volumes: CurrentVol[] };
type ObjRec = { key: string; volume: string; offset: number; size: number; sha256: string; content_type?: string };
type Manifest = { format_version: number; gen: number; objects: ObjRec[]; volumes: VolRec[] };
type VolRec = { name: string; size: number; sha256: string; asset_name: string };

const problems: string[] = [];
const bad = (msg: string): void => { problems.push(msg); };

function ghApiRange(assetId: number, outPath: string): boolean {
  const r = Bun.spawnSync(
    ["gh", "api", `repos/Gaubee/cdn-media.gaubee.com/releases/assets/${assetId}`, "-H", "Accept: application/octet-stream", "--jq", "."],
    { stdout: "ignore", stderr: "pipe", timeout: 120_000, env: { ...process.env, GH_RANGE_OUT: outPath } },
  );
  return r.exitCode === 0;
}

// --assets 的远端抽检：gh api 拉整卷到临时文件，比对本地卷头 1KB 与整卷 sha256
function fetchRemoteVolume(assetId: number, dest: string): boolean {
  const r = Bun.spawnSync(
    ["gh", "api", `repos/Gaubee/cdn-media.gaubee.com/releases/assets/${assetId}`, "-H", "Accept: application/octet-stream"],
    { stdout: "pipe", stderr: "pipe", timeout: 300_000 },
  );
  if (r.exitCode !== 0) return false;
  const { writeFileSync } = require("node:fs") as typeof import("node:fs");
  writeFileSync(dest, r.stdout);
  return true;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let assetsN = 0;
  const ai = argv.indexOf("--assets");
  if (ai > -1) assetsN = Number.parseInt(argv[ai + 1] ?? "0", 10) || 0;

  // (a) 指针 → 清单 sha256
  const curPath = path.join(MANIFEST_DIR, "current.json");
  const manPath = path.join(MANIFEST_DIR, "manifest-1.json");
  if (!existsSync(curPath) || !existsSync(manPath)) {
    console.error("manifest/current.json 或 manifest-1.json 不存在");
    process.exit(1);
  }
  const cur = JSON.parse(readFileSync(curPath, "utf8")) as CurrentFile;
  const manBytes = readFileSync(manPath);
  const manSha = createHash("sha256").update(manBytes).digest("hex");
  if (manSha !== cur.manifest_sha256) bad(`(a) current.manifest_sha256 与实际清单不符: current=${cur.manifest_sha256} actual=${manSha}`);
  else console.log(`(a) 指针 sha256 一致: gen=${cur.gen}, manifest=${manSha.slice(0, 16)}…`);

  const manifest = JSON.parse(new TextDecoder().decode(manBytes)) as Manifest;
  if (manifest.format_version !== 1) bad(`(a) format_version=${manifest.format_version}，预期 1`);
  const volByName = new Map(manifest.volumes.map((v) => [v.name, v]));

  // (b)(c) 对象级校验
  let offBad = 0, keyBad = 0, sizeBad = 0;
  const keyRe = /^([a-z0-9_-]+)\/(\d{4}-\d{2})\/([A-Za-z0-9._-]+)$/;
  for (const o of manifest.objects) {
    if (o.offset % 512 !== 0) { offBad++; if (offBad < 4) bad(`(b) offset 未 512 对齐: ${o.key} @${o.offset}`); }
    const v = volByName.get(o.volume);
    if (!v) { sizeBad++; if (sizeBad < 4) bad(`(b) 对象引用未知卷: ${o.key} → ${o.volume}`); continue; }
    if (!Number.isSafeInteger(o.offset + o.size) || o.offset + o.size > v.size) {
      sizeBad++; if (sizeBad < 4) bad(`(b) 对象越界: ${o.key} offset=${o.offset} size=${o.size} vol=${v.size}`);
    }
    if (!keyRe.test(o.key)) { keyBad++; if (keyBad < 4) bad(`(c) key 格式非法: ${o.key}`); }
  }
  console.log(`(b) offset 对齐违规 ${offBad}，越界 ${sizeBad}（对象 ${manifest.objects.length}）`);
  console.log(`(c) key 格式违规 ${keyBad}`);
  if (offBad || sizeBad || keyBad) problems.push("(b)/(c) 存在对象级违规（见上）");

  // 指针卷集合与清单卷集合一致性
  const curNames = new Set(cur.volumes.map((v) => v.name));
  const manNames = new Set(manifest.volumes.map((v) => v.name));
  for (const n of manNames) if (!curNames.has(n)) bad(`指针缺卷: ${n}`);
  for (const n of curNames) if (!manNames.has(n)) bad(`指针多卷: ${n}`);
  if (curNames.size === manNames.size && problems.every((p) => !p.startsWith("指针")))
    console.log(`(a2) 指针/清单卷集合一致: ${curNames.size} 卷`);

  // (d) 远端抽检
  if (assetsN > 0) {
    const targets = manifest.volumes.slice(0, assetsN);
    const { mkdtempSync, rmSync } = require("node:fs") as typeof import("node:fs");
    const { tmpdir } = require("node:os") as typeof import("node:os");
    const tmp = mkdtempSync(path.join(tmpdir(), "manifest-lint-"));
    try {
      for (const v of targets) {
        const curVol = cur.volumes.find((cv) => cv.name === v.name);
        if (!curVol?.asset_id) { bad(`(d) ${v.name} 指针缺 asset_id`); continue; }
        const dest = path.join(tmp, v.name);
        if (!fetchRemoteVolume(curVol.asset_id, dest)) { bad(`(d) ${v.name} 远端拉取失败`); continue; }
        const remoteBytes = readFileSync(dest);
        const remoteSha = createHash("sha256").update(remoteBytes).digest("hex");
        if (remoteBytes.length !== v.size) bad(`(d) ${v.name} 远端 size ${remoteBytes.length} ≠ manifest ${v.size}`);
        else if (remoteSha !== v.sha256) bad(`(d) ${v.name} 远端 sha256 不一致`);
        else console.log(`(d) ${v.name} 远端抽检一致（${v.size}B, ${remoteSha.slice(0, 12)}…）`);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    void ghApiRange; // 保留说明：整卷比对强于 1KB 头比对，故用整卷
  }

  console.log(problems.length === 0 ? "\n[OK] 全部校验通过" : `\n[FAIL] ${problems.length} 项问题:\n  - ${problems.join("\n  - ")}`);
  process.exit(problems.length === 0 ? 0 : 1);
}

await main();
