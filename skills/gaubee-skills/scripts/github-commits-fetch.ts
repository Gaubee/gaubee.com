#!/usr/bin/env bun
import { execSync } from "node:child_process";
/**
 * github-commits-fetch.ts — 每日提交日志（source: github-commits）
 *
 * 文件意图（正交意图清单）：
 * - [2026-10-03] 原始需求（kzf）：抓取每天 github 的提交记录，重点发现 commit 时用了什么新技术（依赖）。
 * - 1. 从公开事件流抓取今天的 PushEvent（本地日期分组）→ history/<date>.json
 * - 2. 该源「变更」即当日提交本身 → changes/<date>.json（added = 各仓推送摘要，兼容 build-report glob）
 *
 * 已知边界（v1）：公开事件流只含公开仓库；payload.commits 为空时（force push 等）只记数量。
 * 运行：bun scripts/github-commits-fetch.ts（依赖 gh 已登录）
 */
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import { localDate, sourceDir, writeFileAtomic } from "./lib.ts";

const SRC = sourceDir("github-commits");
const HISTORY = path.join(SRC, "history");
const CHANGES = path.join(SRC, "changes");

interface PushCommit {
  sha: string;
  message: string;
}

interface RepoPush {
  repo: string;
  url: string;
  count: number;
  commits: PushCommit[]; // 可能为空（详情不可用时）
  pushed_at: string;
  private: boolean; // 隐私关键：私有仓不进发布视图（changes）
}

/** GitHub events API 最小类型（注意：PushEvent payload 已不含 size/commits，需 compare API 补取） */
interface GHEvent {
  type: string;
  created_at: string;
  repo?: { name?: string };
  payload?: { before?: string; head?: string; ref?: string };
}

/** compare API 的最小类型 */
interface CompareResult {
  total_commits: number;
  commits: { sha: string; commit: { message: string } }[];
}

interface CommitsSnapshot {
  fetched_at: string;
  user: string;
  date: string;
  pushes: RepoPush[];
  totalCommits: number;
}

function ghToken(): string {
  return process.env.GITHUB_TOKEN ?? execSync("gh auth token", { encoding: "utf8" }).trim();
}

async function main() {
  const token = ghToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "gaubee-skills",
  };
  const ghJson = async (apiPath: string): Promise<unknown> => {
    const res = await fetch(`https://api.github.com${apiPath}`, { headers });
    if (!res.ok)
      throw new Error(`GET ${apiPath} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  };

  const me = (await ghJson("/user")) as { login: string };
  const login = me.login;
  // 可选 --date YYYY-MM-DD 回填历史日（默认今天）；事件流只保留最近 ~14 天，太老的日期抓不到
  const today = localDate();
  let target = today;
  const dateArg = process.argv[2];
  if (dateArg) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateArg) || dateArg > today) {
      console.error(`--date 需为不晚于今天的 YYYY-MM-DD（收到：${dateArg}）`);
      process.exit(2);
    }
    target = dateArg;
  }

  // 事件流按时间倒序；翻页直到遇到早于目标日期的本地日期事件（上限 5 页）
  const events: GHEvent[] = [];
  for (let page = 1; page <= 5; page++) {
    const batch = (await ghJson(`/users/${login}/events?per_page=100&page=${page}`)) as GHEvent[];
    events.push(...batch);
    const last = batch.at(-1);
    if (batch.length < 100 || (last?.created_at && localDate(new Date(last.created_at)) < target))
      break;
  }

  // 今天的 PushEvent 原始事件（payload 只有 before/head/ref，提交明细需 compare API 补取）。
  // 隐私关键（2026-10-03 复核 A1）：认证后的 /user 事件流【包含私有仓】——
  // history 保留全量（本地档案）；changes 是发布视图，只允许公开仓。
  const rawPushes: { repo: string; before: string; head: string; created_at: string }[] = [];
  for (const e of events) {
    if (e.type !== "PushEvent") continue;
    if (localDate(new Date(e.created_at)) !== target) continue;
    const repo = e.repo?.name ?? "unknown";
    if (!e.payload?.before || !e.payload?.head) continue;
    rawPushes.push({
      repo,
      before: e.payload.before,
      head: e.payload.head,
      created_at: e.created_at,
    });
  }

  // 私有标志：owner 仓复用 deps.json，其它仓查 /repos/{repo} 并缓存
  const privateFlag = new Map<string, boolean>();
  const depsFile = path.join(sourceDir("github-deps"), "deps.json");
  if (existsSync(depsFile)) {
    const deps = JSON.parse(await Bun.file(depsFile).text()) as {
      repos: { repo: string; private: boolean }[];
    };
    for (const r of deps.repos) privateFlag.set(r.repo, r.private);
  }
  async function isPrivate(repo: string): Promise<boolean> {
    const cached = privateFlag.get(repo);
    if (cached !== undefined) return cached;
    try {
      const info = (await ghJson(`/repos/${repo}`)) as { private?: boolean };
      privateFlag.set(repo, !!info.private);
      return !!info.private;
    } catch {
      return true; // 查不到的仓按私有处理（宁可不公开，不可泄漏）
    }
  }

  // 按时间序处理（事件流最新在前），保证 entry.commits 跨多次推送也是旧→新
  const byRepo = new Map<string, RepoPush>();
  for (const p of [...rawPushes].reverse()) {
    const entry = byRepo.get(p.repo) ?? {
      repo: p.repo,
      url: `https://github.com/${p.repo}`,
      count: 0,
      commits: [],
      pushed_at: localStamp(new Date(p.created_at)),
      private: await isPrivate(p.repo),
    };
    entry.private = await isPrivate(p.repo);
    entry.pushed_at = localStamp(new Date(p.created_at));
    try {
      const cmp = (await ghJson(
        `/repos/${p.repo}/compare/${p.before}...${p.head}`,
      )) as CompareResult;
      entry.count += cmp.total_commits ?? cmp.commits.length;
      // compare 返回最新在前，转为时间序（旧→新），摘要取最新 3 条时语义正确
      entry.commits.push(
        ...cmp.commits
          .slice()
          .reverse()
          .map((c) => ({ sha: c.sha.slice(0, 7), message: c.commit.message })),
      );
    } catch {
      entry.count += 0; // 明细不可用（force push / 分支删除等），仅记录事件发生
    }
    byRepo.set(p.repo, entry);
  }

  const pushes = [...byRepo.values()].sort((a, b) => (a.repo < b.repo ? -1 : 1));
  const totalCommits = pushes.reduce((n, p) => n + p.count, 0);
  const publicPushes = pushes.filter((p) => !p.private);
  const hidden = pushes.length - publicPushes.length;
  const snapshot: CommitsSnapshot = {
    fetched_at: new Date().toISOString(),
    user: login,
    date: target,
    pushes,
    totalCommits,
  };

  mkdirSync(HISTORY, { recursive: true });
  mkdirSync(CHANGES, { recursive: true });
  const json = JSON.stringify(snapshot, null, 1);
  writeFileAtomic(path.join(HISTORY, `${target}.json`), json);

  // 该源的「变更」= 发布视图：仅公开仓（私有仓留在 history 供本地技能 Graph 使用）
  const changes = {
    date: target,
    prev_date: "",
    baseline: false,
    added: publicPushes.map((p) => {
      const msgs = p.commits.length
        ? p.commits
            .slice(-3)
            .map((c) => c.message.split("\n")[0]!.slice(0, 60))
            .join(" | ")
        : p.count > 0
          ? "（提交明细不可用，仅计数）"
          : "（推送事件，明细不可用）";
      return {
        full_name: `${p.repo}（${p.count} commits）`,
        html_url: p.url,
        description: msgs,
        language: "",
      };
    }),
    removed: [],
    changed: [],
  };
  writeFileAtomic(path.join(CHANGES, `${target}.json`), JSON.stringify(changes, null, 1));

  if (pushes.length === 0) {
    console.log(`no pushes on ${target}`);
  } else {
    console.log(
      `commits ${target}: ${totalCommits} commits across ${pushes.length} repos（公开 ${publicPushes.length} 仓进发布视图，私有 ${hidden} 仓仅本地）`,
    );
    for (const p of pushes)
      console.log(`- ${p.repo}: ${p.count}${p.private ? "（私有，仅本地）" : ""}`);
  }
}

/** 本地时区时间戳（YYYY-MM-DD HH:MM），避免 UTC 截断造成跨午夜困惑 */
function localStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
