#!/usr/bin/env bun
/**
 * gate-consistency-audit — 两个提交门禁的口径交叉校验
 *
 * 背景（2026-11-25 实证）：同一份报告的同一批数字，两个门禁给出相反结论。
 * `report-commit-count-audit` 按快照里的 `private` 字段求和，判「公开 12 + 私有 18」为 OK；
 * `report-facts-check` 按仓库名正则（`fde2e|keel|jixoai/bu$|omni`）判私有，把已转公开的
 * `keel`、`reply9842` 算成私有，于是同一句被判成「公开 6 + 私有 24」——两个门禁互相打脸，
 * 而真正错的是后者的判定口径（`gh repo view` 显示 keel 与 reply9842 都是 PUBLIC）。
 *
 * 本工具不重算数字，只做一件事：把两个门禁对同一份报告、同一个日期跑一遍，比较结论。
 * 任一方向出现「一个 ok、另一个 fail」即判口径冲突，退出 1。
 *
 * 用法：
 *   bun tools/2026-11-25-gate-consistency-audit/gate-consistency-audit.ts [--date 2026-11-25]
 *   bun tools/2026-11-25-gate-consistency-audit/gate-consistency-audit.ts --all
 * 退出码：0 = 两个门禁结论一致（都 ok 或都 fail）；1 = 口径冲突；2 = 环境缺失。只读。
 */
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const SKILL = process.env.GAUBEE_SITE
  ? path.join(process.env.GAUBEE_SITE, "skills", "gaubee-skills")
  : path.resolve(import.meta.dir, "..", "..");
const DATA = process.env.GAUBEE_SKILLS_DATA ?? path.join(os.homedir(), ".gaubee-skills", "data");
const REPORTS = path.join(SKILL, "reports", "daily");

interface GateResult {
  name: string;
  exit: number;
  /** 逐项结论（只有 facts-check 会给出细项） */
  items: Array<{ name: string; claimed: string; actual: string; ok: boolean }>;
  raw: string;
}

const run = (cmd: string[]): { exit: number; out: string } => {
  const proc = Bun.spawnSync(cmd, {
    cwd: SKILL,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, PATH: `${os.homedir()}/.vite-plus/bin:${os.homedir()}/.bun/bin:/opt/homebrew/bin:${process.env.PATH ?? ""}` },
  });
  return { exit: proc.exitCode ?? 1, out: `${proc.stdout.toString()}${proc.stderr.toString()}` };
};

function commitAudit(date: string): GateResult {
  const { exit, out } = run([
    "bun",
    "tools/2026-11-12-report-commit-count-audit/report-commit-count-audit.ts",
    "--since",
    date,
  ]);
  // 该工具只对自己找到的偏差报错；在本日期上「没有提到该日」等价于通过。
  const mentions = out.includes(date);
  const failedHere = out.includes("偏差") && mentions;
  return {
    name: "report-commit-count-audit",
    exit: exit === 0 ? 0 : failedHere ? 1 : 0,
    items: [],
    raw: out,
  };
}

function factsCheck(date: string): GateResult {
  const { exit, out } = run([
    "bun",
    "tools/2026-11-19-report-facts-check/report-facts-check.ts",
    date,
  ]);
  const items: GateResult["items"] = [];
  for (const line of out.split("\n")) {
    const m = line.match(/^\s*([✓✗])\s*(.+?)：写\s*(\S+)，实际\s*(\S+)/);
    if (m) items.push({ name: m[2]!.trim(), claimed: m[3]!, actual: m[4]!, ok: m[1] === "✓" });
  }
  return { name: "report-facts-check", exit: exit === 0 ? 0 : 1, items, raw: out };
}

function main(): number {
  const argv = process.argv.slice(2);
  if (!existsSync(SKILL) || !existsSync(DATA)) {
    console.error(`缺少目录：${!existsSync(SKILL) ? SKILL : DATA}`);
    return 2;
  }
  const all = argv.includes("--all");
  const di = argv.indexOf("--date");
  const dates = all
    ? ["2026-11-22", "2026-11-23", "2026-11-24", "2026-11-25"]
    : [di >= 0 ? argv[di + 1] ?? "" : new Date(Date.now() - 24 * 3600_000).toLocaleDateString("sv-SE")];

  let conflicts = 0;
  for (const date of dates) {
    if (!existsSync(path.join(REPORTS, `${date}.md`))) {
      console.log(`SKIP ${date}  GitHub 日报尚未生成，跳过口径对比`);
      continue;
    }
    const a = commitAudit(date);
    const b = factsCheck(date);
    const same = a.exit === b.exit;
    console.log(`${same ? "OK  " : "冲突"} ${date}  ${a.name}=${a.exit === 0 ? "ok" : "fail"}  ${b.name}=${b.exit === 0 ? "ok" : "fail"}`);
    if (!same) {
      conflicts += 1;
      const bad = b.items.filter((i) => !i.ok);
      for (const item of bad) {
        console.log(`      ${item.name}：报告写 ${item.claimed}，facts-check 算 ${item.actual}`);
      }
      console.log(`      提示：数字以 ${b.exit === 0 ? a.name : b.name} 的细项为准；先用 gh repo view 核对仓库 visibility 再改任一门禁。`);
    }
  }
  if (conflicts) {
    console.error(`\n${conflicts} 个日期口径冲突。`);
    return 1;
  }
  console.log("\nGATE CONSISTENCY OK：两个门禁结论一致。");
  return 0;
}

if (import.meta.main) process.exit(main());
