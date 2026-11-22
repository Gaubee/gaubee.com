#!/usr/bin/env bun
/**
 * report-facts-check — 日报里的数字逐项对账（口径取自脚本，不靠人读）
 *
 * 背景（2026-11-19 实证）：写 2026-11-18 日报时，我把补丁卷的文件数写成 87，
 * 实际是 55（mass 来源是另一个卷的日志）。这类错误不会被人眼抓住，
 * 但会让报告的可信度整体下降。report-lint 只查「星标累计」，提交数有专门工具，
 * 媒体/译文/图谱这些数字一直没人核。
 *
 * 本工具把一个日期报表里的数字抽出来，与权威源逐项比对：
 *   - 总数 N（星标累计）      ← stars.json 按 starred_at 统计
 *   - 新增 N 个               ← changes/<date+1>.json 的 added（改名会容忍：等于 added 减去改名对数）
 *   - 公开 N + 私有 M         ← commits history 按仓归属
 *   - gen N / N 个文件 / N MB ← cdn-media manifest 与补丁卷
 *   - 译文累计 N              ← translations 文件条数
 *   - N 条边                  ← tech-graph stats.edges
 *
 * 「只对最新一天硬判」：历史报表里的媒体/译文/图谱数字记录的是当时的水位，
 * 现在比对必然漂移，所以那些项在非最新日期只做提示。
 *
 * 用法：
 *   bun tools/2026-11-19-report-facts-check/report-facts-check.ts 2026-11-18
 *   bun tools/2026-11-19-report-facts-check/report-facts-check.ts 2026-11-18 --json
 * 退出码：0 = 核心数字全对；1 = 有硬错误；2 = 参数/文件缺失。只读。
 */
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = process.env.GAUBEE_SKILLS_DATA ?? path.join(os.homedir(), ".gaubee-skills", "data");
const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..", "..");
const SKILL = path.join(SITE, "skills", "gaubee-skills");
const CDN = path.join(SITE, "cdn-media");

const ymd = (d: Date): string => d.toLocaleDateString("sv-SE");
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

type Severity = "ok" | "error" | "warn";
interface Check {
  name: string;
  claimed: string;
  actual: string;
  severity: Severity;
  note?: string;
}

function readJson<T>(file: string): T | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function main(): number {
  const argv = process.argv.slice(2);
  const date = argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const asJson = argv.includes("--json");
  if (!date) {
    console.error("用法：report-facts-check.ts YYYY-MM-DD [--json]");
    return 2;
  }
  const file = path.join(SKILL, "reports", "daily", `${date}.md`);
  if (!existsSync(file)) {
    console.error(`报告不存在：${file}`);
    return 2;
  }
  const text = readFileSync(file, "utf8");
  const isLatest = date === ymd(addDays(new Date(), -1));
  const checks: Check[] = [];

  // 星标累计
  const stars = readJson<{ repos?: Array<{ starred_at?: string }> }>(
    path.join(DATA, "sources", "github-stars", "stars.json"),
  );
  if (stars?.repos) {
    const cum = stars.repos.filter((r) => r.starred_at && ymd(new Date(r.starred_at)) <= date).length;
    const claimed = text.match(/总数\s*(\d+)/)?.[1];
    if (claimed) {
      checks.push({
        name: "星标累计",
        claimed,
        actual: String(cum),
        severity: Number(claimed) === cum ? "ok" : "error",
      });
    }
  }

  // 新增数：按 starred_at 落在该日统计（与日报写作口径一致）。
  // 不能用 changes[run-day] 的 added 减改名——两者会打架（2026-11-19 实证：
  // goeist-font 的 starred_at 是 11-16，却出现在 changes[11-16] 里，
  // 用它算 11-16 的新增会漏掉它；改名也不影响 starred_at，天然被排除）。
  {
    const claimed = text.match(/新增\s*(\d+)\s*个/)?.[1];
    if (claimed && stars?.repos) {
      const real = stars.repos.filter((r) => r.starred_at && ymd(new Date(r.starred_at)) === date).length;
      checks.push({
        name: "星标新增",
        claimed,
        actual: String(real),
        severity: Number(claimed) === real ? "ok" : "error",
        note: "按 starred_at 落在该日统计",
      });
    }
  }

  // 提交公私分列
  const commits = readJson<{ totalCommits?: number; pushes?: Array<{ repo: string; count: number }> }>(
    path.join(DATA, "sources", "github-commits", "history", `${date}.json`),
  );
  const m = text.match(/公开仓\s*(\d+)\s*条\s*\+\s*私有仓\s*(\d+)\s*条/);
  if (commits?.pushes && m) {
    const priv = commits.pushes.filter((p) => /fde2e|keel|jixoai\/bu$|omni/.test(p.repo));
    const privN = priv.reduce((n, p) => n + p.count, 0);
    const pubN = (commits.totalCommits ?? 0) - privN;
    checks.push({
      name: "提交公开数",
      claimed: m[1]!,
      actual: String(pubN),
      severity: Number(m[1]) === pubN ? "ok" : "error",
    });
    checks.push({
      name: "提交私有数",
      claimed: m[2]!,
      actual: String(privN),
      severity: Number(m[2]) === privN ? "ok" : "error",
    });
  }

  // 媒体：gen / 文件数 / MB（只对最新一天硬判）
  const runDay = ymd(addDays(new Date(`${date}T12:00:00`), 1));
  const pointer = readJson<{ gen?: number; manifest_path?: string }>(path.join(CDN, "manifest", "current.json"));
  // 只认「媒体入卷 gen N」这种管道段写法：正文里别处也可能出现 gen（例如提交段写
  // 「媒体 gen 43 换代」），取第一个匹配会把两处混淆（2026-11-23 实证：报 43 实际 44）。
  const genClaim = text.match(/媒体入卷\s*gen\s*(\d+)/)?.[1] ?? text.match(/gen\s*(\d+)/)?.[1];
  if (pointer?.gen && genClaim) {
    checks.push({
      name: "媒体 gen",
      claimed: genClaim,
      actual: String(pointer.gen),
      severity: Number(genClaim) === pointer.gen ? "ok" : isLatest ? "error" : "warn",
      note: isLatest ? undefined : "历史报表记的是当时水位",
    });
  }
  // 补丁卷文件数：找报告里「N 个文件」，与当日补丁卷成员数比
  const filesClaim = text.match(/(\d+)\s*个文件/)?.[1];
  if (pointer?.gen) {
    const manifest = readJson<{ volumes?: Array<{ name?: string; members?: number }> }>(
      path.join(CDN, "manifest", `manifest-${pointer.gen}.json`),
    );
    const patch = manifest?.volumes?.find((v) => (v.name ?? "").includes(`patch-${runDay}`));
    if (filesClaim && patch?.members !== undefined) {
      checks.push({
        name: "补丁卷文件数",
        claimed: filesClaim,
        actual: String(patch.members),
        severity: Number(filesClaim) === patch.members ? "ok" : isLatest ? "error" : "warn",
      });
    }
  }

  // 译文累计
  const transClaim = text.match(/译文累计\s*(\d+)/)?.[1];
  const trans = readJson<Record<string, string>>(path.join(SKILL, "translations", "x-tweets.zh.json"));
  if (transClaim && trans) {
    const n = Object.keys(trans).length;
    checks.push({
      name: "译文累计",
      claimed: transClaim,
      actual: String(n),
      severity: Number(transClaim) === n ? "ok" : isLatest ? "error" : "warn",
      note: isLatest ? undefined : "历史报表记的是当时水位",
    });
  }

  // 图谱边数
  const edgeClaim = text.match(/(\d+)\s*条边/)?.[1];
  const graph = readJson<{ stats?: { edges?: number } }>(path.join(DATA, "tech-graph.json"));
  if (edgeClaim && graph?.stats?.edges !== undefined) {
    checks.push({
      name: "图谱边数",
      claimed: edgeClaim,
      actual: String(graph.stats.edges),
      severity: Number(edgeClaim) === graph.stats.edges ? "ok" : isLatest ? "error" : "warn",
    });
  }

  if (asJson) {
    console.log(JSON.stringify({ date, checks }, null, 2));
    return checks.some((c) => c.severity === "error") ? 1 : 0;
  }

  console.log(`report-facts-check：${date}${isLatest ? "（最新一天，硬判）" : "（历史，媒体类只提示）"}`);
  for (const c of checks) {
    const mark = c.severity === "ok" ? "✓" : c.severity === "warn" ? "△" : "✗";
    console.log(`  ${mark} ${c.name}：写 ${c.claimed}，实际 ${c.actual}${c.note ? `（${c.note}）` : ""}`);
  }
  const errors = checks.filter((c) => c.severity === "error");
  if (errors.length) {
    console.error(`\n${errors.length} 项数字对不上：${errors.map((c) => c.name).join("、")}`);
    return 1;
  }
  console.log("\nREPORT FACTS OK：核心数字与脚本口径一致");
  return 0;
}

process.exit(main());
