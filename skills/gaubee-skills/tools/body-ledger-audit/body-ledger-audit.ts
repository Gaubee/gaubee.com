#!/usr/bin/env bun
/**
 * body-ledger-audit — 体力账本自洽体检
 *
 * 校验：每日 used 之和 ≤ budget、unused = budget − Σused、日期无重复。
 * 输出最近 N 天的消耗，供每日维护判断「今天还剩几点」。
 *
 * 用法：
 *   bun tools/body-ledger-audit/body-ledger-audit.ts
 *   bun tools/body-ledger-audit/body-ledger-audit.ts --days 14
 * 退出码：0 = 账本自洽；1 = 有不一致；2 = 账本缺失（首次运行属正常）。
 */
import { existsSync } from "node:fs";

import { DAILY_BUDGET, LEDGER_PATH, readLedger, remainingToday } from "../../scripts/lib/body-ledger.ts";

function main(): number {
  const argv = process.argv.slice(2);
  const di = argv.indexOf("--days");
  const days = di >= 0 ? Number(argv[di + 1] ?? 7) : 7;

  if (!existsSync(LEDGER_PATH)) {
    console.log(`账本还没建立（${LEDGER_PATH}）——首次运行属正常，第一次记录后自动创建`);
    return 2;
  }
  const ledger = readLedger();
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const d of ledger.days) {
    if (seen.has(d.date)) issues.push(`${d.date}：日期重复`);
    seen.add(d.date);
    const used = d.used.length;
    if (!d.unlimited && used > d.budget) issues.push(`${d.date}：用了 ${used} 点，超过额度 ${d.budget}`);
    if (!d.unlimited) {
      const expect = Math.max(0, d.budget - used);
      if (d.unused !== expect) issues.push(`${d.date}：unused 写 ${d.unused}，应为 ${expect}`);
    }
  }

  const today = ledger.days.find((d) => d.date === new Date().toLocaleDateString("sv-SE"));
  const remainText = today?.unlimited ? "不限（迁移模式）" : String(remainingToday(ledger));
  console.log(`体力账本：${ledger.days.length} 天记录，今日额度 ${DAILY_BUDGET}，剩余 ${remainText}`);
  console.log(`\n最近 ${Math.min(days, ledger.days.length)} 天：`);
  for (const d of ledger.days.slice(-days)) {
    const ops =
      d.used.map((u) => `${u.op}${u.mode ? `(${u.mode})` : ""}:${u.tools.join("+")}`).join("、") || "（无操作）";
    console.log(`  ${d.date}  用 ${d.used.length}/${d.unlimited ? "不限" : d.budget}  剩 ${d.unused}  ${ops}`);
  }

  if (issues.length) {
    console.error(`\n${issues.length} 处不一致：`);
    for (const i of issues) console.error(`  ✗ ${i}`);
    return 1;
  }
  console.log("\nLEDGER OK：账本自洽");
  return 0;
}

process.exit(main());
