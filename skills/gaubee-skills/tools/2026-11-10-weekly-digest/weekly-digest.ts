#!/usr/bin/env bun
/**
 * weekly-digest — 周报动笔前的跨源素材拼盘
 *
 * 写周报最费时间的不是分析，而是把「这一周各仓提交都在干什么」从 7 份日报里捞出来。
 * 这个工具按区间聚合三样东西：
 *   1. 每个仓库的提交数与代表消息（按日期去重，最多 N 条/仓）；
 *   2. 每天新增星标，附 taxonomy 分类（按人工策展行匹配 full_name）；
 *   3. X 动态按 kind 的每日计数。
 * 输出 Markdown，直接贴进周报「分析」草稿当骨架，分析仍由 agent 写。
 *
 * 用法：
 *   bun tools/2026-11-10-weekly-digest/weekly-digest.ts [--since 2026-11-02] [--until 2026-11-08]
 *   bun tools/2026-11-10-weekly-digest/weekly-digest.ts --last-week
 *   bun tools/2026-11-10-weekly-digest/weekly-digest.ts --out /tmp/w45.md
 * 退出码：0 = 正常；1 = 区间无数据。零网络，只读。
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = process.env.GAUBEE_SKILLS_DATA ?? path.join(os.homedir(), ".gaubee-skills", "data");
const COMMITS = path.join(DATA, "sources", "github-commits", "history");
const STARS_CHANGES = path.join(DATA, "sources", "github-stars", "changes");
const X_CHANGES = path.join(DATA, "sources", "x-likes", "changes");
const TAXONOMY = path.join(DATA, "taxonomy.md");

interface CommitPush {
  repo: string;
  count: number;
  private?: boolean;
  commits: { message: string }[];
}

const ymd = (d: Date): string => d.toLocaleDateString("sv-SE");
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

function lastWeekRange(): { since: string; until: string } {
  const today = new Date();
  const dow = today.getDay() === 0 ? 7 : today.getDay(); // 周一=1
  const thisMonday = addDays(today, 1 - dow);
  const lastMonday = addDays(thisMonday, -7);
  const lastSunday = addDays(thisMonday, -1);
  return { since: ymd(lastMonday), until: ymd(lastSunday) };
}

function datesBetween(since: string, until: string): string[] {
  const out: string[] = [];
  const start = new Date(`${since}T12:00:00`);
  const end = new Date(`${until}T12:00:00`);
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(ymd(d));
  return out;
}

/** taxonomy：full_name → 最近的 `### 分类` 标题 */
function taxonomyMap(): Map<string, string> {
  const map = new Map<string, string>();
  if (!existsSync(TAXONOMY)) return map;
  let section = "";
  for (const line of readFileSync(TAXONOMY, "utf8").split("\n")) {
    const h = line.match(/^### (.+?)[（(]\d+[）)]\s*$/);
    if (h) {
      section = h[1]!.trim();
      continue;
    }
    const m = line.match(/^- \[([^\]]+)\]\(https:\/\/github\.com\//);
    if (m && section) map.set(m[1]!, section);
  }
  return map;
}

function main(): number {
  const argv = process.argv.slice(2);
  let { since, until } = lastWeekRange();
  if (argv.includes("--last-week")) {
    // 默认即上周
  } else {
    const sIdx = argv.indexOf("--since");
    const uIdx = argv.indexOf("--until");
    if (sIdx >= 0) since = argv[sIdx + 1] ?? since;
    if (uIdx >= 0) until = argv[uIdx + 1] ?? until;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since) || !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
    console.error("--since/--until 需要 YYYY-MM-DD");
    return 2;
  }
  const dates = datesBetween(since, until);
  const tax = taxonomyMap();

  // ---- 提交 ----
  const repoCommits = new Map<string, { count: number; messages: string[]; private: boolean }>();
  for (const date of dates) {
    const file = path.join(COMMITS, `${date}.json`);
    if (!existsSync(file)) continue;
    const h = JSON.parse(readFileSync(file, "utf8")) as { pushes?: CommitPush[] };
    for (const p of h.pushes ?? []) {
      const cur = repoCommits.get(p.repo) ?? { count: 0, messages: [], private: Boolean(p.private) };
      cur.count += p.count;
      for (const c of p.commits ?? []) {
        const subject = c.message.split("\n")[0]!.trim();
        if (subject && !cur.messages.includes(subject)) cur.messages.push(subject);
      }
      repoCommits.set(p.repo, cur);
    }
  }

  // ---- 星标 ----
  const starRows: { date: string; repo: string; category: string }[] = [];
  for (const date of dates) {
    const file = path.join(STARS_CHANGES, `${date}.json`);
    if (!existsSync(file)) continue;
    const c = JSON.parse(readFileSync(file, "utf8")) as {
      added?: { full_name: string; starred_at?: string }[];
    };
    for (const a of c.added ?? []) {
      // changes 按运行日命名，归属看 starred_at：只收本地日期落在区间内的
      if (a.starred_at && !dates.includes(a.starred_at)) continue;
      starRows.push({ date: a.starred_at ?? date, repo: a.full_name, category: tax.get(a.full_name) ?? "未分类" });
    }
  }

  // ---- X ----
  const xRows: { date: string; kind: string; n: number }[] = [];
  for (const date of dates) {
    const file = path.join(X_CHANGES, `${date}.json`);
    if (!existsSync(file)) continue;
    const c = JSON.parse(readFileSync(file, "utf8")) as {
      added?: { kind?: string; language?: string }[];
    };
    const byKind = new Map<string, number>();
    // x-likes 的 changes 沿用「language」字段存 kind（posted/liked/...）
    for (const a of c.added ?? []) {
      const kind = a.kind ?? a.language ?? "?";
      byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
    }
    for (const [kind, n] of byKind) xRows.push({ date, kind, n });
  }

  if (repoCommits.size === 0 && starRows.length === 0) {
    console.error(`区间 ${since}..${until} 无提交与星标数据（检查 history/changes 是否齐全）`);
    return 1;
  }

  const lines: string[] = [];
  lines.push(`# 周素材 ${since} ~ ${until}`, "");
  lines.push("## 提交（按仓库）", "");
  const repos = [...repoCommits.entries()].sort((a, b) => b[1].count - a[1].count);
  for (const [repo, v] of repos) {
    const tag = v.private ? "（私有）" : "";
    lines.push(`### ${repo}${tag} — ${v.count} 条`);
    for (const m of v.messages.slice(0, 6)) lines.push(`- ${m}`);
    if (v.messages.length > 6) lines.push(`- …另 ${v.messages.length - 6} 条`);
    lines.push("");
  }
  lines.push("## 星标（按分类）", "");
  const byCat = new Map<string, string[]>();
  for (const s of starRows) {
    const list = byCat.get(s.category) ?? [];
    list.push(`${s.repo}（${s.date}）`);
    byCat.set(s.category, list);
  }
  for (const [cat, list] of [...byCat.entries()].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`- **${cat}** ${list.length}：${list.join("、")}`);
  }
  lines.push("", "## X 动态（按 kind）", "");
  for (const r of xRows.sort((a, b) => a.date.localeCompare(b.date))) {
    lines.push(`- ${r.date} ${r.kind} ${r.n}`);
  }
  const out = lines.join("\n") + "\n";
  const outIdx = argv.indexOf("--out");
  if (outIdx >= 0) {
    const target = path.resolve(argv[outIdx + 1] ?? "");
    writeFileSync(target, out);
    console.log(`已写 ${target}（${repos.length} 仓 / ${starRows.length} 星标 / ${xRows.length} 组 X）`);
  } else {
    console.log(out);
  }
  return 0;
}

process.exit(main());
