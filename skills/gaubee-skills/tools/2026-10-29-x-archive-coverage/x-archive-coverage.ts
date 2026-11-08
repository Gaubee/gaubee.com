#!/usr/bin/env bun
/**
 * x-archive-coverage — X 归档覆盖对账（posted/reposted 维度）
 *
 * xd-window-audit 管 liked 的「恰一窗」（日报维度）；本工具管 posted/reposted 的
 * 归档覆盖：x.json 里这两类条目按推文本地日聚合，逐日核对是否已有 x-archive-<date>.md
 * 或 X 日报（x-daily / 旧混合报）覆盖。缺档/孤档双侧报告。
 * 口径（2026-11-08 修）：GitHub 日报不算 X 覆盖（它不含 X 内容）；孤档只算「有归档
 * 但库存该日完全无条目」，只有 liked 的日子不再误报。
 *
 * 用法：bun tools/2026-10-29-x-archive-coverage/x-archive-coverage.ts
 * 退出码：0 = 双侧对齐；1 = 有缺口。纯本地秒级。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const DATA = process.env.GAUBEE_SKILLS_DATA ?? path.join(os.homedir(), ".gaubee-skills", "data");
const XJSON = path.join(DATA, "sources", "x-likes", "x.json");
const EVENTS = process.env.GAUBEE_SITE
  ? path.join(process.env.GAUBEE_SITE, "src", "content", "events")
  : path.resolve(import.meta.dir, "..", "..", "..", "..", "src", "content", "events");

function localDay(iso: string): string {
  return new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
}

function main(): number {
  if (!existsSync(XJSON) || !existsSync(EVENTS)) {
    console.error(`数据缺失：${XJSON} 或 ${EVENTS}`);
    return 1;
  }
  const x = JSON.parse(readFileSync(XJSON, "utf8")) as {
    items: Record<string, { kind?: string; created_at?: string }>;
  };
  // 推文本地日 → posted/reposted 条数
  const want = new Map<string, number>();
  // 任意 kind 的本地日集合（孤儿判定用：有 liked 的日期不算无源）
  const anyDay = new Set<string>();
  for (const t of Object.values(x.items)) {
    if (!t.created_at) continue;
    const d = localDay(t.created_at);
    anyDay.add(d);
    if (t.kind !== "posted" && t.kind !== "reposted") continue;
    want.set(d, (want.get(d) ?? 0) + 1);
  }
  // 站点侧已有归档日期集合 + 策展日报覆盖日期（x-daily / 旧混合报）
  const have = new Set<string>();
  const dailyCovered = new Set<string>();
  for (const f of readdirSync(EVENTS)) {
    const m = f.match(/^0\d+\.x-archive-(\d{4}-\d{2}-\d{2})\.md$/);
    if (m) have.add(m[1]!);
    const d = f.match(/(?:signals-daily|x-daily)-(\d{4}-\d{2}-\d{2})/)?.[1];
    if (d) dailyCovered.add(d);
  }

  // 缺档 = 有 posted/reposted、既没有归档也没有 X 日报覆盖（GitHub 日报不算 X 覆盖）
  const missing = [...want.keys()].filter((d) => !have.has(d) && !dailyCovered.has(d)).sort();
  // 孤档 = 有归档但库存里该日完全没有 X 条目（旧口径把「只有 liked」的日子全判成孤档，噪声 812 天）
  const orphan = [...have].filter((d) => !anyDay.has(d)).sort();
  console.log(`x.json posted/reposted 共 ${[...want.values()].reduce((a, b) => a + b, 0)} 条、分布 ${want.size} 天；站点归档 ${have.size} 天`);
  if (missing.length) {
    console.log(`缺档 ${missing.length} 天：`);
    for (const d of missing.slice(0, 15)) console.log(`  ${d}（${want.get(d)} 条）`);
    if (missing.length > 15) console.log(`  … 共 ${missing.length} 天`);
  }
  if (orphan.length) {
    console.log(`无源孤档 ${orphan.length} 天（库存无对应 posted/reposted，可能曾删或口径调整）：`);
    for (const d of orphan.slice(0, 8)) console.log(`  ${d}`);
  }
  if (missing.length || orphan.length) return 1;
  console.log("双侧对齐：每个有动态的日期都有归档，且无孤档");
  return 0;
}

process.exit(main());
