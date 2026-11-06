#!/usr/bin/env bun
/**
 * vol-name-plan — 补丁卷名预演：未来哪天打包、会叫什么卷名、会不会撞名
 *
 * 背景：补丁卷名是 patch-<文件月份组>-<打包日 DD>.tar。跨月回填时，DD 可能与
 * 「该月份组自己月份的补丁日」重合（2026-11-07 打包 2026-10 组就撞上 10-07 的卷）。
 * 打包器现在会按跨月顺延 seq 处理，但排期的人需要提前知道哪天会撞、顺延后叫什么，
 * 以及旧月份组的清仓窗口到底在哪天。本工具只读 manifest 做预演，不写任何文件。
 *
 * 用法：
 *   bun tools/2026-11-07-vol-name-plan/vol-name-plan.ts [--days 14] [--json] [--staging <dir>]
 * 退出码：0 = 正常；1 = 读不到 manifest / staging。纯本地只读。
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..", "..");
const CDN = process.env.CDN_MEDIA_DIR ?? path.join(SITE, "cdn-media");
const DEFAULT_STAGING = path.join(CDN, "staging", "x");

interface Manifest {
  gen: number;
  objects: { key: string; size: number }[];
  volumes: { name: string }[];
}

interface PlanRow {
  date: string;
  month: string;
  base: string;
  status: "free" | "cross-month-seq" | "same-day-blocked";
  actual: string | null;
  staged: number;
  bytes: number;
}

const pad = (n: number): string => String(n).padStart(2, "0");
const ymd = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const day = (date: string): string => date.slice(8, 10);

function loadManifest(): Manifest | null {
  const cur = path.join(CDN, "manifest", "current.json");
  if (!existsSync(cur)) return null;
  const pointer = JSON.parse(readFileSync(cur, "utf8")) as { gen: number; manifest?: string };
  const file = pointer.manifest
    ? path.join(CDN, "manifest", path.basename(pointer.manifest))
    : path.join(CDN, "manifest", `manifest-${pointer.gen}.json`);
  if (!existsSync(file)) return null;
  const mf = JSON.parse(readFileSync(file, "utf8")) as Manifest;
  return { gen: mf.gen ?? pointer.gen, objects: mf.objects ?? [], volumes: mf.volumes ?? [] };
}

/** staging 里各月份组的未入卷文件：数量与字节 */
function pendingByMonth(manifest: Manifest, staging: string): Map<string, { count: number; bytes: number }> {
  const keys = new Set(manifest.objects.map((o) => o.key));
  const out = new Map<string, { count: number; bytes: number }>();
  if (!existsSync(staging)) return out;
  for (const month of readdirSync(staging)) {
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    const dir = path.join(staging, month);
    let count = 0;
    let bytes = 0;
    for (const name of readdirSync(dir)) {
      if (/\.(part|ytdl)$/.test(name) || name.includes(".part-Frag")) continue;
      if (keys.has(`x/${month}/${name}`)) continue;
      const st = statSync(path.join(dir, name));
      if (!st.isFile()) continue;
      count++;
      bytes += st.size;
    }
    if (count > 0) out.set(month, { count, bytes });
  }
  return out;
}

/** 该月该日已存在的补丁卷里最大的 seq（无 seq 后缀的基名记为 1） */
function maxSeq(volumes: string[], month: string, dd: string): number {
  const base = `patch-${month}-${dd}`;
  let max = 0;
  for (const name of volumes) {
    if (name === `${base}.tar`) max = Math.max(max, 1);
    const m = new RegExp(`^${base}-(\\d+)\\.tar$`).exec(name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

function plan(manifest: Manifest, groups: Map<string, { count: number; bytes: number }>, days: number): PlanRow[] {
  const names = new Set(manifest.volumes.map((v) => v.name));
  const rows: PlanRow[] = [];
  const today = new Date();
  for (let i = 0; i < days; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    const date = ymd(d);
    const dd = day(date);
    const packingMonth = date.slice(0, 7);
    for (const [month, pending] of [...groups.entries()].sort()) {
      const base = `patch-${month}-${dd}.tar`;
      const exists = names.has(base);
      let status: PlanRow["status"] = "free";
      let actual: string | null = base;
      if (exists) {
        if (month === packingMonth) {
          status = "same-day-blocked";
          actual = null;
        } else {
          status = "cross-month-seq";
          actual = `patch-${month}-${dd}-${maxSeq(manifest.volumes.map((v) => v.name), month, dd) + 1}.tar`;
        }
      }
      rows.push({ date, month, base, status, actual, staged: pending.count, bytes: pending.bytes });
    }
  }
  return rows;
}

function main(): number {
  const argv = process.argv.slice(2);
  const daysIdx = argv.indexOf("--days");
  const days = daysIdx >= 0 ? Math.max(1, Number(argv[daysIdx + 1]) || 14) : 14;
  const asJson = argv.includes("--json");
  const stagingIdx = argv.indexOf("--staging");
  const staging = stagingIdx >= 0 ? path.resolve(argv[stagingIdx + 1] ?? "") : DEFAULT_STAGING;

  const manifest = loadManifest();
  if (!manifest) {
    console.error(`读不到 manifest（${path.join(CDN, "manifest")}）`);
    return 1;
  }
  if (!existsSync(staging)) {
    console.error(`staging 目录缺失：${staging}`);
    return 1;
  }
  const groups = pendingByMonth(manifest, staging);
  if (groups.size === 0) {
    console.log(`manifest gen ${manifest.gen}：staging 没有待打包文件，无需排期`);
    return 0;
  }
  const rows = plan(manifest, groups, days);
  if (asJson) {
    console.log(JSON.stringify({ gen: manifest.gen, days, groups: Object.fromEntries(groups), rows }, null, 2));
    return 0;
  }

  console.log(`manifest gen ${manifest.gen} · 待打包月份组 ${groups.size} 个（未来 ${days} 天预演）`);
  for (const [m, p] of [...groups.entries()].sort()) {
    console.log(`  ${m}：${p.count} 文件 / ${(p.bytes / 1024 ** 2).toFixed(1)} MB`);
  }
  console.log("");
  console.log("日期         月份组   基础卷名                      状态");
  for (const r of rows) {
    const label =
      r.status === "free"
        ? "可用"
        : r.status === "cross-month-seq"
          ? `跨月撞名 → ${r.actual}`
          : "同日同月重复 → 拒绝（打包器会 die）";
    console.log(`${r.date}  ${r.month}  ${r.base.padEnd(28)}  ${label}`);
  }
  const firstFree = new Map<string, string>();
  for (const r of rows) {
    if (r.status !== "same-day-blocked" && !firstFree.has(r.month)) firstFree.set(r.month, r.date);
  }
  console.log("");
  for (const [m, d] of [...firstFree.entries()].sort()) {
    const hit = rows.find((r) => r.month === m && r.date === d)!;
    console.log(`最早可打包日：${m} → ${d}（${hit.actual}）`);
  }
  console.log("说明：同日同月重复只在「当月组当天已经打过补丁」时出现，打包器按设计拒绝；");
  console.log("      跨月组撞名会顺延 seq 出全新卷，A2 不变（绝不覆盖已引用卷）。");
  return 0;
}

process.exit(main());
