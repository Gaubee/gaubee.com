#!/usr/bin/env bun
/**
 * repo-rename-reconciler — 星标仓库改名对账（GitHub 301 探测）
 *
 * `github-stars-diff` 把改名表现为「移除 1 + 新增 1」。描述没变的能靠
 * stars-integrity-audit 的「描述 + starred_at 相同」配对上，但**改名同时改了描述**的
 * 会漏掉（2026-11-10 实证：Pluviobyte/douyin-comments → saas-growth-agents，描述从
 * 抖音评论技能扩成 SaaS 增长 agent 包）。
 *
 * 做法：扫描最近 N 天 changes 里被移除的仓库，用 `gh api repos/<old>` 跟随 GitHub 的
 * 301 重定向拿新名字；配对后检查 taxonomy.md 是否还引用旧名。
 *
 * 用法：
 *   bun tools/2026-11-10-repo-rename-reconciler/repo-rename-reconciler.ts [--days 7] [--strict]
 * 退出码：0 = 无待处理（--strict 且有 taxonomy 未更新时 1）；2 = 数据缺失。只读（gh 只发 GET）。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = process.env.GAUBEE_SKILLS_DATA ?? path.join(os.homedir(), ".gaubee-skills", "data");
const CHANGES = path.join(DATA, "sources", "github-stars", "changes");
const TAXONOMY = path.join(DATA, "taxonomy.md");

interface Pair {
  from: string;
  to: string;
  taxonomy: "updated" | "stale" | "absent";
}

/** gh api 跟随 301：返回重定向后的 full_name；仓库已删/无法访问返回 null */
function resolveRename(oldName: string): string | null {
  try {
    const out = execFileSync("gh", ["api", `repos/${oldName}`, "--jq", ".full_name"], {
      encoding: "utf8",
      timeout: 20_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out && out !== oldName ? out : null;
  } catch {
    return null;
  }
}

function main(): number {
  const argv = process.argv.slice(2);
  const daysIdx = argv.indexOf("--days");
  const days = daysIdx >= 0 ? Math.max(1, Number(argv[daysIdx + 1]) || 7) : 7;
  const strict = argv.includes("--strict");
  if (!existsSync(CHANGES) || !existsSync(TAXONOMY)) {
    console.error(`缺少输入：${CHANGES} 或 ${TAXONOMY}`);
    return 2;
  }
  const files = readdirSync(CHANGES)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .slice(-days);
  const removed = new Set<string>();
  for (const f of files) {
    const c = JSON.parse(readFileSync(path.join(CHANGES, f), "utf8")) as {
      removed?: { full_name: string }[];
    };
    for (const r of c.removed ?? []) removed.add(r.full_name);
  }
  if (removed.size === 0) {
    console.log(`最近 ${files.length} 天 changes 没有被移除的仓库`);
    return 0;
  }

  const taxonomy = readFileSync(TAXONOMY, "utf8");
  const pairs: Pair[] = [];
  for (const oldName of [...removed].sort()) {
    const to = resolveRename(oldName);
    if (!to) continue;
    const hasOld = taxonomy.includes(oldName);
    const hasNew = taxonomy.includes(to);
    pairs.push({ from: oldName, to, taxonomy: hasOld ? "stale" : hasNew ? "updated" : "absent" });
  }

  console.log(`检查最近 ${files.length} 天的 ${removed.size} 个移除项（gh 301 探测）`);
  if (pairs.length === 0) {
    console.log("改名：无（移除项都查不到重定向，可能是真取消收藏或仓库已删）");
    return 0;
  }
  for (const p of pairs) {
    const label =
      p.taxonomy === "updated" ? "taxonomy 已更新" : p.taxonomy === "stale" ? "✗ taxonomy 仍引用旧名" : "△ taxonomy 未收录新名";
    console.log(`  ${p.from} → ${p.to}：${label}`);
  }
  const needFix = pairs.filter((p) => p.taxonomy !== "updated");
  console.log(
    needFix.length === 0
      ? "全部改名已在 taxonomy 对齐"
      : `待处理 ${needFix.length} 项：按新名字更新 taxonomy 对应分类行（保留原描述语义）`,
  );
  return strict && needFix.length > 0 ? 1 : 0;
}

process.exit(main());
