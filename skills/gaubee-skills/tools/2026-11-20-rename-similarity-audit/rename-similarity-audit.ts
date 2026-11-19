#!/usr/bin/env bun
/**
 * rename-similarity-audit — 用相似度认出「描述也改了的改名」
 *
 * 背景（2026-11-20 实证）：rename-impact-audit 只认「描述与 starred_at 完全相同」的改名。
 * 那天 9 条新增里其实有 3 条是改名，只有 electric-pglite → pglite 被抓到，
 * pgx → pgboxdb（描述重写）与 webrtc-sdk/webrtc → livekit/libwebrtc（描述为空）
 * 都漏了，只能靠人眼。
 *
 * 做法：对同日 removed × added 的每一对打分：
 *   - starred_at 完全相同      权重 3
 *   - owner 相同               权重 2
 *   - 仓库名词根重叠           权重 2（pgx/pgboxdb 这类）
 *   - 描述 token 重叠 ≥ 0.35   权重 2
 * 总分 ≥ 4 判为「疑似改名」，≥ 6 判为「高置信」，供人确认。
 *
 * 本工具只出候选，不改数据、不改 taxonomy——改名是否成立要看人的判断。
 *
 * 用法：
 *   bun tools/2026-11-20-rename-similarity-audit/rename-similarity-audit.ts
 *   bun tools/2026-11-20-rename-similarity-audit/rename-similarity-audit.ts --date 2026-11-20
 * 退出码：0 = 已输出；2 = 数据缺失。只读。
 */
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = process.env.GAUBEE_SKILLS_DATA ?? path.join(os.homedir(), ".gaubee-skills", "data");
const CHANGES = path.join(DATA, "sources", "github-stars", "changes");

interface Repo {
  full_name?: string;
  description?: string;
  starred_at?: string;
}
interface Changes {
  date?: string;
  added?: Repo[];
  removed?: Repo[];
}

const ymd = (d: Date): string => d.toLocaleDateString("sv-SE");
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function tokens(text?: string): Set<string> {
  const out = new Set<string>();
  if (!text) return out;
  for (const w of text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? []) out.add(w);
  return out;
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / Math.min(a.size, b.size);
}

/** 仓库名的词根重叠：把名字拆成小写词，看有多少共同片段（pgx ⊂ pgboxdb） */
function nameAffinity(oldName: string, newName: string): number {
  const base = (s: string): string => s.split("/")[1]?.toLowerCase() ?? s.toLowerCase();
  const a = base(oldName);
  const b = base(newName);
  if (a === b) return 1;
  // 字符级包含（pgx 是 pgboxdb 的子序列）或共享 4 字符以上前缀
  const subseq = (short: string, long: string): boolean => {
    let i = 0;
    for (const ch of long) if (ch === short[i]) i++;
    return i === short.length;
  };
  if (a.length >= 3 && b.length >= 3 && (subseq(a, b) || subseq(b, a))) return 1;
  const prefix = (x: string, y: string): number => {
    let i = 0;
    while (i < x.length && i < y.length && x[i] === y[i]) i++;
    return i;
  };
  const p = prefix(a, b);
  return p >= 4 ? p / Math.max(a.length, b.length) : 0;
}

interface Candidate {
  from: string;
  to: string;
  score: number;
  verdict: "高置信" | "疑似";
  reasons: string[];
}

function main(): number {
  const argv = process.argv.slice(2);
  const di = argv.indexOf("--date");
  const date = di >= 0 ? argv[di + 1]! : ymd(addDays(new Date(), 0));
  const file = path.join(CHANGES, `${date}.json`);
  if (!existsSync(file)) {
    console.error(`缺少 ${file}`);
    return 2;
  }
  const j = JSON.parse(readFileSync(file, "utf8")) as Changes;
  const removed = j.removed ?? [];
  const added = j.added ?? [];
  if (removed.length === 0 || added.length === 0) {
    console.log(`${date}：没有 removed×added 组合，无改名候选`);
    return 0;
  }

  const out: Candidate[] = [];
  for (const r of removed) {
    if (!r.full_name) continue;
    for (const a of added) {
      if (!a.full_name || a.full_name === r.full_name) continue;
      const reasons: string[] = [];
      let score = 0;
      if (r.starred_at && a.starred_at && r.starred_at === a.starred_at) {
        score += 3;
        reasons.push("starred_at 相同");
      }
      const ownerSame = r.full_name.split("/")[0] === a.full_name.split("/")[0];
      if (ownerSame) {
        score += 2;
        reasons.push("owner 相同");
      }
      const na = nameAffinity(r.full_name, a.full_name);
      if (na > 0) {
        score += Math.round(2 * na);
        reasons.push(`名字相近 ${(na * 100).toFixed(0)}%`);
      }
      const d = overlap(tokens(r.description), tokens(a.description));
      if (d >= 0.35) {
        score += 2;
        reasons.push(`描述重叠 ${(d * 100).toFixed(0)}%`);
      }
      if (score >= 4) {
        out.push({
          from: r.full_name,
          to: a.full_name,
          score,
          verdict: score >= 6 ? "高置信" : "疑似",
          reasons,
        });
      }
    }
  }

  console.log(`${date}：removed ${removed.length} × added ${added.length}，改名候选 ${out.length} 个`);
  if (out.length === 0) {
    console.log("RENAME SIMILARITY：没有达到阈值的候选");
    return 0;
  }
  out.sort((x, y) => y.score - x.score);
  for (const c of out) {
    console.log(`  [${c.verdict} ${c.score}] ${c.from} → ${c.to}`);
    console.log(`      ${c.reasons.join("；")}`);
  }
  console.log("\n提示：高置信的多半是真改名，疑似项要人看一眼（可能是同一作者的另一个仓）。");
  return 0;
}

process.exit(main());
