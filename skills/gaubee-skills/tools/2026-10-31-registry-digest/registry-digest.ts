#!/usr/bin/env bun
/**
 * registry-digest — 工坊待裁决清单汇总卡
 *
 * REGISTRY.md 的 proposed 行数会随工坊日积月累（2026-10-31 已 18 个）。本工具
 * 把待裁决条目按日期汇总成一张裁决卡（工具 / 一句话 / 首跑发现），kzf 直接在
 * 卡上打勾（留/弃/改），裁决结果由学习闭环回写。只读，零写入。
 *
 * 用法：bun tools/2026-10-31-registry-digest/registry-digest.ts [--md 路径]
 * 退出码：0 = 正常；1 = REGISTRY 缺失。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const REGISTRY = path.resolve(import.meta.dir, "..", "..", "tools", "REGISTRY.md");

function main(): number {
  if (!existsSync(REGISTRY)) {
    console.error(`REGISTRY 缺失：${REGISTRY}`);
    return 1;
  }
  const rows = readFileSync(REGISTRY, "utf8")
    .split("\n")
    .filter((l) => /^\| \d{4}-\d{2}-\d{2} \|/.test(l))
    .map((l) => l.split("|").map((c) => c.trim()))
    .filter((c) => c.length >= 6);
  // 列序：日期 | 工具 | 路径 | 一句话 | 状态 | 备注
  const proposed = rows.filter((c) => c[5] === "proposed");
  const decided = rows.length - proposed.length;

  const lines: string[] = [];
  lines.push(`# 工坊待裁决卡（${new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" })}）`);
  lines.push("");
  lines.push(`proposed ${proposed.length} 个｜已裁决 ${decided} 个。每行末尾写「留 / 弃 / 改 + 一句理由」即可完成批量裁决。`);
  lines.push("");
  for (const c of proposed) {
    const brief = (c[4] ?? "").replace(/\|/g, "；");
    lines.push(`- [ ] **${c[1]}**（${c[2]}）：${brief} → ______`);
  }
  const card = lines.join("\n");
  const mdIdx = process.argv.indexOf("--md");
  if (mdIdx >= 0 && process.argv[mdIdx + 1]) {
    writeFileSync(process.argv[mdIdx + 1]!, card + "\n");
    console.log(`裁决卡 → ${process.argv[mdIdx + 1]}`);
  }
  console.log(card);
  return 0;
}

process.exit(main());
