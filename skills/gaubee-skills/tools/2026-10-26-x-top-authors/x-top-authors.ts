#!/usr/bin/env bun
/**
 * x-top-authors — X 点赞作者榜
 *
 * 回答「我最近总在赞谁」：从 x.json 聚合 kind=liked 条目按作者计数，
 * 默认最近 30 天窗口（--days 0 看全库），输出 top N 作者、条数与最近互动日期。
 * 纯本地秒级，零网络零写入。
 *
 * 用法：bun tools/2026-10-26-x-top-authors/x-top-authors.ts [--days 30] [--top 10]
 * 退出码：0 正常；1 数据缺失。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const DATA = process.env.GAUBEE_SKILLS_DATA ?? path.join(os.homedir(), ".gaubee-skills", "data");
const XJSON = path.join(DATA, "sources", "x-likes", "x.json");

interface Entry {
  id: string;
  author?: string;
  kind?: string;
  created_at?: string;
}

function main(): number {
  if (!existsSync(XJSON)) {
    console.error(`x.json 不存在：${XJSON}`);
    return 1;
  }
  const argv = process.argv.slice(2);
  const days = Number(argv[argv.indexOf("--days") + 1] ?? 30);
  const top = Math.max(1, Number(argv[argv.indexOf("--top") + 1] ?? 10) || 10);

  const x = JSON.parse(readFileSync(XJSON, "utf8")) as { items?: Record<string, Entry> };
  const items = Object.values(x.items ?? {}).filter((t) => t.kind === "liked");

  const now = Date.now();
  const cutoff = Number.isFinite(days) && days > 0 ? now - days * 24 * 3600_000 : 0;
  const stat = new Map<string, { n: number; latest: number }>();
  for (const t of items) {
    const ts = t.created_at ? Date.parse(t.created_at) : 0;
    if (cutoff && ts && ts < cutoff) continue;
    const a = t.author ?? "(unknown)";
    const cur = stat.get(a) ?? { n: 0, latest: 0 };
    cur.n++;
    if (ts > cur.latest) cur.latest = ts;
    stat.set(a, cur);
  }

  const rows = [...stat.entries()]
    .sort((a, b) => b[1].n - a[1].n || b[1].latest - a[1].latest)
    .slice(0, top);
  const inWindow = [...stat.values()].reduce((s, v) => s + v.n, 0);
  const label = days > 0 ? `最近 ${days} 天` : "全库";
  console.log(`${label} liked ${inWindow} 条（库存 liked 共 ${items.length}），top ${Math.min(top, rows.length)} 作者：`);
  for (const [a, v] of rows) {
    const d = v.latest ? new Date(v.latest).toISOString().slice(0, 10) : "?";
    console.log(`  @${a}  ${v.n} 条  最近 ${d}`);
  }
  return 0;
}

process.exit(main());
