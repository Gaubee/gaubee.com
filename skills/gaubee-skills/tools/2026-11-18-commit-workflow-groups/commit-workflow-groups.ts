#!/usr/bin/env bun
/**
 * commit-workflow-groups — 把一天的提交按「工作流候选」预先聚类
 *
 * 背景（2026-11-18）：日报的提交段要求按工作流归组写人话，而不是罗列「N commits」。
 * 但 grouping 一直是人读消息手工做的：13 条还能读，99 条就要花很久。
 * 本工具先把显而易见的归属算出来：
 *   - 同一仓库同一前缀（feat/fix/docs/chore/refactor/test）→ 一组
 *   - 同一仓库里消息语义相近的（共享 3 个以上中文词或标签）→ 候选并组
 * 输出「组 + 条数 + 代表消息」，人只需要判断要不要合并跨仓库的同主线。
 *
 * 不做的事：不改写消息、不写报告、不判断跨仓库是否同一主线（那需要理解业务）。
 *
 * 用法：
 *   bun tools/2026-11-18-commit-workflow-groups/commit-workflow-groups.ts 2026-11-17
 *   bun tools/2026-11-18-commit-workflow-groups/commit-workflow-groups.ts            # 默认昨天
 * 退出码：0 = 已输出；2 = 参数或数据缺失。
 */
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = process.env.GAUBEE_SKILLS_DATA ?? path.join(os.homedir(), ".gaubee-skills", "data");
const HISTORY = path.join(DATA, "sources", "github-commits", "history");

interface Commit {
  sha: string;
  message: string;
}
interface Push {
  repo: string;
  count: number;
  commits: Commit[];
}
interface History {
  date?: string;
  totalCommits?: number;
  pushes?: Push[];
}

const ymd = (d: Date): string => d.toLocaleDateString("sv-SE");
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

const CONVENTIONAL = /^(\w+)(?:\(([^)]+)\))?[:：]/;

/** 从消息里抽「实词」用于相似度：中文按二字切，英文按单词，去停用词 */
function tokens(text: string): Set<string> {
  const stop = new Set(["the", "and", "for", "with", "from", "into", "this", "that", "add", "fix", "update", "and"]);
  const out = new Set<string>();
  for (const w of text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? []) if (!stop.has(w)) out.add(w);
  for (const seg of text.match(/[\u4e00-\u9fa5]{2,}/g) ?? []) {
    for (let i = 0; i + 2 <= seg.length; i++) out.add(seg.slice(i, i + 2));
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

interface Group {
  repo: string;
  label: string;
  commits: Commit[];
}

function main(): number {
  const arg = process.argv[2];
  const date = arg && /^\d{4}-\d{2}-\d{2}$/.test(arg) ? arg : ymd(addDays(new Date(), -1));
  const file = path.join(HISTORY, `${date}.json`);
  if (!existsSync(file)) {
    console.error(`缺少 ${file}`);
    return 2;
  }
  const h = JSON.parse(readFileSync(file, "utf8")) as History;
  const pushes = h.pushes ?? [];
  if (pushes.length === 0) {
    console.log(`${date}：没有提交`);
    return 0;
  }

  const groups: Group[] = [];
  for (const p of pushes) {
    // 先按 conventional 前缀分桶
    const byPrefix = new Map<string, Commit[]>();
    for (const c of p.commits) {
      const m = c.message.match(CONVENTIONAL);
      const key = m ? `${m[1]}${m[2] ? `(${m[2]})` : ""}` : "其它";
      const arr = byPrefix.get(key) ?? [];
      arr.push(c);
      byPrefix.set(key, arr);
    }
    for (const [label, cs] of byPrefix) groups.push({ repo: p.repo, label, commits: cs });
  }

  // 同仓库内把语义相近的组并起来（共享词 > 30%）
  const merged: Group[] = [];
  for (const g of groups) {
    const text = g.commits.map((c) => c.message).join(" ");
    const tg = tokens(text);
    const target = merged.find(
      (m) => m.repo === g.repo && jaccard(tokens(m.commits.map((c) => c.message).join(" ")), tg) > 0.3,
    );
    if (target) target.commits.push(...g.commits);
    else merged.push({ ...g, commits: [...g.commits] });
  }

  merged.sort((a, b) => b.commits.length - a.commits.length);
  console.log(`${date}：${h.totalCommits ?? pushes.reduce((n, p) => n + p.count, 0)} 条提交 → ${merged.length} 个工作流候选组\n`);
  for (const g of merged) {
    const first = g.commits[0]!.message.split("\n")[0]!;
    console.log(`【${g.repo}】${g.label}（${g.commits.length} 条）`);
    console.log(`  ${first.slice(0, 110)}`);
    for (const c of g.commits.slice(1, 3)) console.log(`  · ${c.message.split("\n")[0]!.slice(0, 100)}`);
    if (g.commits.length > 3) console.log(`  · …另 ${g.commits.length - 3} 条`);
  }
  console.log("\n提示：跨仓库的同一主线需要人判断（工具只看单仓库内的相似度）。");
  return 0;
}

process.exit(main());
