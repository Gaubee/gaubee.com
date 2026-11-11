#!/usr/bin/env bun
/**
 * report-commit-count-audit — 日报「公开仓 N 条 + 私有仓 M 条」与本地提交日志对账
 *
 * 日报的提交段是手写归纳，开头那行「公开仓 X 条 + 私有仓 Y 条」最容易抄错（尤其是
 * 补跑日多仓并计）。本工具读当天 github-commits/history 的 pushes，按 private 标记
 * 求和，与日报里的数字逐日对账。没有该句式的旧日报跳过。
 *
 * 用法：
 *   bun tools/2026-11-12-report-commit-count-audit/report-commit-count-audit.ts [--since 2026-11-01]
 * 退出码：0 = 全部一致（或无可对账行）；1 = 有偏差；2 = 目录缺失。纯本地只读。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = process.env.GAUBEE_SKILLS_DATA ?? path.join(os.homedir(), ".gaubee-skills", "data");
const HISTORY = path.join(DATA, "sources", "github-commits", "history");
const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..", "..");
const REPORTS = path.join(SITE, "skills", "gaubee-skills", "reports", "daily");

interface Push {
  count: number;
  private?: boolean;
}

function main(): number {
  const argv = process.argv.slice(2);
  const sinceIdx = argv.indexOf("--since");
  const since = sinceIdx >= 0 ? argv[sinceIdx + 1] ?? "" : "2026-10-01";
  for (const p of [HISTORY, REPORTS]) {
    if (!existsSync(p)) {
      console.error(`缺少目录：${p}`);
      return 2;
    }
  }
  const files = readdirSync(REPORTS)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
    .filter((f) => f.slice(0, 10) >= since)
    .sort();
  let checked = 0;
  const bad: string[] = [];
  for (const f of files) {
    const date = f.slice(0, 10);
    const text = readFileSync(path.join(REPORTS, f), "utf8");
    const m = text.match(/公开仓\s*(\d+)\s*条\s*\+\s*私有仓\s*(\d+)\s*条/);
    if (!m) continue;
    const histFile = path.join(HISTORY, `${date}.json`);
    if (!existsSync(histFile)) {
      bad.push(`${f}：本地没有该日 history，无法对账`);
      continue;
    }
    const h = JSON.parse(readFileSync(histFile, "utf8")) as { pushes?: Push[] };
    let pub = 0;
    let priv = 0;
    for (const p of h.pushes ?? []) {
      if (p.private) priv += p.count;
      else pub += p.count;
    }
    checked++;
    const claimPub = Number(m[1]);
    const claimPriv = Number(m[2]);
    if (claimPub !== pub || claimPriv !== priv) {
      bad.push(`${f}：写「公开 ${claimPub} + 私有 ${claimPriv}」，实测「公开 ${pub} + 私有 ${priv}」`);
    }
  }
  console.log(`对账 ${checked} 份日报（since ${since}）`);
  if (bad.length) {
    console.error(`偏差 ${bad.length} 项：`);
    for (const b of bad) console.error(`  - ${b}`);
    return 1;
  }
  console.log("REPORT COUNT OK：公开/私有提交数与本地日志一致（没有该句式的旧日报已跳过）");
  return 0;
}

process.exit(main());
