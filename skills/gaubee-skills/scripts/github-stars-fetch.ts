#!/usr/bin/env bun
/**
 * github-stars-fetch.ts — 抓取 GitHub 星标（source: github-stars）
 *
 * 文件意图（正交意图清单）：
 * - [2026-10-03] 原始需求（kzf）："抓取我的 github star 整理成 skill；每天定时抓取找变更。"
 * - 1. 抓取当前 gh 登录账号全部 star → data/sources/github-stars/history/<date>.json + stars.json
 * - 2. 快照滚动保留 90 天；stdout 输出与上一份快照的对比摘要行（BASELINE/delta）
 *
 * 运行：bun scripts/github-stars-fetch.ts（依赖 gh 已登录，或 GITHUB_TOKEN 环境变量）
 */
import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

import { localDate, sourceDir, writeFileAtomic, type Snapshot, type StarRepo } from "./lib.ts";

const SRC = sourceDir("github-stars");
const HISTORY = path.join(SRC, "history");
const KEEP_DAYS = 90;

function getToken(): string {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  return execSync("gh auth token", { encoding: "utf8" }).trim();
}

/** GitHub starred API（star+json media type）的最小类型 */
interface RawStarred {
  starred_at: string | null;
  repo: {
    full_name: string;
    html_url: string;
    description: string | null;
    homepage: string | null;
    language: string | null;
    topics: string[] | null;
    stargazers_count: number;
    pushed_at: string | null;
    archived: boolean;
  };
}

function slim(e: RawStarred): StarRepo {
  const r = e.repo;
  return {
    full_name: r.full_name,
    html_url: r.html_url,
    description: r.description ?? "",
    homepage: r.homepage ?? "",
    language: r.language ?? "",
    topics: r.topics ?? [],
    stars: r.stargazers_count,
    pushed_at: r.pushed_at ?? "",
    archived: !!r.archived,
    // time=0 约定（kzf 2026-10-04）：缺失的时间一律置纪元零点，排序时自然最老
    starred_at: (e.starred_at ?? "").slice(0, 10) || "1970-01-01",
  };
}

async function main() {
  const token = getToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github.star+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "gaubee-skills",
  };
  const ghJson = async (apiPath: string): Promise<unknown> => {
    const res = await fetch(`https://api.github.com${apiPath}`, { headers });
    if (!res.ok) {
      throw new Error(`GET ${apiPath} -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    return res.json();
  };

  const me = (await ghJson("/user")) as { login: string };
  const login = me.login;

  const all: RawStarred[] = [];
  for (let page = 1; ; page++) {
    const batch = (await ghJson(`/user/starred?per_page=100&page=${page}`)) as RawStarred[];
    all.push(...batch);
    if (batch.length < 100) break;
  }

  // order = 收藏序号（1 = 最早）：按 (starred_at, full_name) 稳定排序后编号——
  // 同秒批量导入的并列由此消除歧义，time=0 的缺失时间自然排最前。存储顺序仍为最新在前。
  const asc = all
    .map(slim)
    .sort((a, b) =>
      a.starred_at < b.starred_at
        ? -1
        : a.starred_at > b.starred_at
          ? 1
          : a.full_name < b.full_name
            ? -1
            : 1,
    );
  const repos: StarRepo[] = asc.map((r, i) => ({ ...r, order: i + 1 })).reverse();

  const today = localDate();
  mkdirSync(HISTORY, { recursive: true });
  const snapshot: Snapshot = {
    fetched_at: new Date().toISOString(),
    user: login,
    count: repos.length,
    repos,
  };
  const json = JSON.stringify(snapshot, null, 1);
  writeFileAtomic(path.join(HISTORY, `${today}.json`), json);
  writeFileAtomic(path.join(SRC, "stars.json"), json);

  // 滚动清理 90 天前的快照
  const cutoff = Date.now() - KEEP_DAYS * 86400_000;
  for (const f of readdirSync(HISTORY)) {
    if (!f.endsWith(".json")) continue;
    const d = new Date(`${f.replace(".json", "")}T12:00:00`);
    if (!Number.isNaN(d.getTime()) && d.getTime() < cutoff) rmSync(path.join(HISTORY, f));
  }

  // 与上一份快照对比，输出摘要行
  const prevFiles = readdirSync(HISTORY)
    .filter((f) => f.endsWith(".json") && f !== `${today}.json`)
    .sort();
  if (prevFiles.length === 0) {
    console.log(`BASELINE fetched ${repos.length} stars for @${login} (no previous snapshot)`);
    return;
  }
  const prevFile = prevFiles.at(-1)!;
  const prev: Snapshot = JSON.parse(await Bun.file(path.join(HISTORY, prevFile)).text());
  if (prev.user !== login) {
    console.log(`WARN previous snapshot was for @${prev.user}, current @${login}`);
  }
  console.log(
    `fetched ${repos.length} stars for @${login} (prev ${prev.count} @ ${prevFile.replace(".json", "")}, delta ${repos.length - prev.count})`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
