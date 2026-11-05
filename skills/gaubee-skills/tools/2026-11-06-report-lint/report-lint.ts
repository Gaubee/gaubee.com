#!/usr/bin/env bun
/**
 * report-lint — 报告一致性门禁（占位残留 + 星标累计数对账）
 *
 * 两类真实事故的工具化：
 * 1. 骨架占位残留：周/月/年报的「## 分析（agent 补充）」后面如果还是那行 HTML 注释，
 *    说明分析没补就发布了（生成器会原样带出占位）。
 * 2. 星标累计数漂移：日报里写「总数 M」的 M 必须等于该日星标累计数（按 starred_at
 *    精确统计）。2026-11-04 补跑时三条日报的 M 都少了一位，靠人工重算才发现。
 *
 * 用法：
 *   bun tools/2026-11-06-report-lint/report-lint.ts [--since 2026-10-01] [--all]
 * 退出码：0 = 全绿；1 = 有占位残留或数值不一致；2 = 环境异常。纯本地只读。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..", "..");
const REPORTS = path.join(SITE, "skills", "gaubee-skills", "reports");
const DATA = process.env.GAUBEE_SKILLS_DATA ?? path.join(os.homedir(), ".gaubee-skills", "data");
const STARS = path.join(DATA, "sources", "github-stars", "stars.json");

const PLACEHOLDER = "<!-- 主题聚类、与 profile.md 品味画像的印证/漂移、造工具进展与裁决情况 -->";
const EVENTS = path.join(SITE, "src", "content", "events");

/** 该 slug 是否已发布成事件（只对已发出的内容考占位；未发布草稿不算问题） */
function published(slug: string): boolean {
  if (!existsSync(EVENTS)) return false;
  return readdirSync(EVENTS).some((f) => f.endsWith(`.${slug}.md`));
}

function localDay(iso: string): string {
  return new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
}

/** 日期 → 该日收盘（含当日）星标累计数 */
function cumulativeByDay(): Map<string, number> {
  const byDay = new Map<string, number>();
  if (!existsSync(STARS)) return byDay;
  const raw = JSON.parse(readFileSync(STARS, "utf8")) as { repos: { starred_at?: string }[] };
  const counts = new Map<string, number>();
  for (const r of raw.repos) {
    if (!r.starred_at) continue;
    const d = localDay(r.starred_at);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  let cum = 0;
  for (const d of [...counts.keys()].sort()) {
    cum += counts.get(d)!;
    byDay.set(d, cum);
  }
  return byDay;
}

function cumAt(map: Map<string, number>, day: string): number | null {
  let best: string | null = null;
  for (const d of map.keys()) if (d <= day && (!best || d > best)) best = d;
  return best ? map.get(best)! : null;
}

function main(): number {
  const argv = process.argv.slice(2);
  const sinceIdx = argv.indexOf("--since");
  const all = argv.includes("--all");
  const since = sinceIdx >= 0 ? argv[sinceIdx + 1]! : "2026-10-01";
  if (!existsSync(REPORTS)) {
    console.error(`reports 目录缺失：${REPORTS}`);
    return 2;
  }
  const cum = cumulativeByDay();
  const problems: string[] = [];

  // 1) 占位残留（周/月/年报 + 日报）
  for (const kind of ["daily", "weekly", "monthly", "yearly"]) {
    const dir = path.join(REPORTS, kind);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".md")) continue;
      const day = f.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
      if (!all && day && day < since) continue;
      const text = readFileSync(path.join(dir, f), "utf8");
      if (!text.includes(PLACEHOLDER)) continue;
      // 只有已发布的报告才考占位：未发布的骨架是草稿，不算问题
      if (kind !== "daily") {
        const stem = f.replace(/\.md$/, "");
        const slug = kind === "weekly" ? `signals-weekly-${stem.split("-")[1]}` : `signals-${kind}ly-${stem}`;
        if (!published(slug)) continue;
      } else if (!published(`github-daily-${day}`) && !published(`x-daily-${day}`)) continue;
      problems.push(`${kind}/${f}：分析节仍是占位注释（已发布）`);
    }
  }

  // 2) 星标累计数对账（只看 GitHub 日报，X 日报没有这个数）
  const dailyDir = path.join(REPORTS, "daily");
  if (existsSync(dailyDir)) {
    for (const f of readdirSync(dailyDir)) {
      const m = f.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
      if (!m) continue;
      const day = m[1]!;
      if (!all && day < since) continue;
      const text = readFileSync(path.join(dailyDir, f), "utf8");
      const claimed = text.match(/总数\s*([0-9]+)/)?.[1];
      if (!claimed) continue; // 无星标节的日报（如零变更日）不校验
      const real = cumAt(cum, day);
      if (real !== null && Number(claimed) !== real)
        problems.push(`daily/${f}：写「总数 ${claimed}」，实测该日累计 ${real}`);
    }
  }

  if (problems.length) {
    console.error(`报告一致性问题 ${problems.length} 项（since ${all ? "全部" : since}）：`);
    for (const p of problems.slice(0, 20)) console.error(`  - ${p}`);
    if (problems.length > 20) console.error(`  - …共 ${problems.length} 项`);
    return 1;
  }
  console.log(`report-lint OK：占位与分析齐全、星标累计数一致（since ${all ? "全部" : since}）`);
  return 0;
}

process.exit(main());
