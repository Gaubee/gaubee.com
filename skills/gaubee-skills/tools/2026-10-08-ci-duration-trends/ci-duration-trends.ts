#!/usr/bin/env bun
/**
 * ci-duration-trends — GitHub Actions 耗时趋势（只读）
 *
 * 背景：kzf 关注 CI 耗时（gh 并行 jobs 免费提速的信号），日常守着 gaubee.com 的
 * Docker 构建；但 gh run list 的原始列表不方便回答「最近有没有变慢 / 最慢的是哪次」。
 *
 * 做什么（全部只读，不触发任何远端操作）：
 *   1. `gh run list --repo <repo> --limit <n>` 拉最近 N 次运行；
 *   2. 只取已完成的运行，按 workflow 名分组：次数/平均/最快/最慢耗时；
 *   3. 趋势：最近 5 次平均 vs 更早平均（样本 <6 次则不评趋势）；
 *   4. 单次最耗时 top5，附 commit 消息首行。
 *
 * 用法：
 *   bun ci-duration-trends.ts                          # 默认 Gaubee/gaubee.com 最近 30 次
 *   bun ci-duration-trends.ts --repo OWNER/REPO --limit 50
 *
 * 零第三方依赖；耗时 = updatedAt - startedAt（gh 未提供 startedAt 时退回 createdAt，
 * 含排队时间，趋势比较内部一致即可）。
 */

import { execFileSync } from "node:child_process";

interface Run {
  name: string;
  displayTitle: string;
  status: string;
  conclusion: string | null;
  createdAt: string;
  startedAt: string | null;
  updatedAt: string | null;
  databaseId: number;
}

interface Group {
  name: string;
  count: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
  recent5AvgMs: number | null;
  olderAvgMs: number | null;
}

const args = process.argv.slice(2);
const argOf = (flag: string): string | undefined => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
if (args.some((a, i) => !["--repo", "--limit"].includes(a) && !["--repo", "--limit"].includes(args[i - 1] ?? ""))) {
  console.error("用法: bun ci-duration-trends.ts [--repo OWNER/REPO] [--limit N]");
  process.exit(2);
}
const repo = argOf("--repo") ?? "Gaubee/gaubee.com";
const limit = Number(argOf("--limit") ?? 30);
if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
  console.error("--limit 须为 1~200 的整数");
  process.exit(2);
}

let raw: string;
try {
  raw = execFileSync("gh", [
    "run", "list", "--repo", repo, "--limit", String(limit),
    "--json", "name,displayTitle,status,conclusion,createdAt,startedAt,updatedAt,databaseId",
  ], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
} catch (err) {
  console.error(`ci-duration-trends: gh run list 失败（${String(err)}）`);
  console.error("请确认已 gh auth login 且仓库可读。");
  process.exit(1);
}

const runs = (JSON.parse(raw) as Run[]).filter((r) => r.status === "completed" && r.updatedAt);
if (runs.length === 0) {
  console.log(`ci-duration-trends：${repo} 最近 ${limit} 次中没有已完成的运行`);
  process.exit(0);
}

const durationMs = (r: Run): number =>
  new Date(r.updatedAt!).getTime() - new Date(r.startedAt ?? r.createdAt).getTime();

const fmt = (ms: number): string =>
  ms >= 60_000 ? `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s` : `${Math.round(ms / 1000)}s`;

const byName = new Map<string, Run[]>();
for (const r of runs) {
  const list = byName.get(r.name) ?? [];
  list.push(r);
  byName.set(r.name, list);
}

const groups: Group[] = [];
for (const [name, list] of byName) {
  // list 按时间正序排列后计算趋势
  const chrono = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const ds = chrono.map(durationMs);
  const recent = ds.slice(-5);
  const older = ds.slice(0, -5);
  const avg = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
  groups.push({
    name,
    count: ds.length,
    avgMs: avg(ds),
    minMs: Math.min(...ds),
    maxMs: Math.max(...ds),
    recent5AvgMs: recent.length ? avg(recent) : null,
    olderAvgMs: older.length ? avg(older) : null,
  });
}
groups.sort((a, b) => b.count - a.count);

console.log(`ci-duration-trends：${repo}（最近 ${limit} 次，完成 ${runs.length} 次）\n`);
console.log("按 workflow 分组（耗时=运行窗口，含排队）：");
for (const g of groups) {
  let trend = "样本不足";
  if (g.recent5AvgMs !== null && g.olderAvgMs !== null) {
    const delta = g.recent5AvgMs - g.olderAvgMs;
    const pct = Math.round((delta / g.olderAvgMs) * 100);
    trend = `${delta >= 0 ? "变慢" : "变快"} ${Math.abs(pct)}%（近5次 ${fmt(g.recent5AvgMs)} vs 更早 ${fmt(g.olderAvgMs)}）`;
  }
  console.log(
    `  ${g.name}：${g.count} 次，均值 ${fmt(g.avgMs)}，最快 ${fmt(g.minMs)}，最慢 ${fmt(g.maxMs)}；趋势 ${trend}`,
  );
}

console.log("\n单次最耗时 top5：");
const top = [...runs].sort((a, b) => durationMs(b) - durationMs(a)).slice(0, 5);
for (const r of top) {
  const title = (r.displayTitle || "").split("\n")[0]!.slice(0, 60);
  console.log(`  ${fmt(durationMs(r))}  ${r.name}  #${r.databaseId}  ${title}`);
}
