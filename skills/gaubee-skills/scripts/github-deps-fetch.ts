#!/usr/bin/env bun
import { execSync } from "node:child_process";
/**
 * github-deps-fetch.ts — 项目依赖清单与新技术检测（source: github-deps）
 *
 * 文件意图（正交意图清单）：
 * - [2026-10-03] 原始需求（kzf）：我所有项目 + 项目中使用的技术纳入技能 Graph；重点发现 commit 时用了什么新技术（依赖）。
 * - 1. 拉取全部 owner 仓库（含私有）根目录 package.json 的 dependencies + devDependencies
 * - 2. 与上一份快照 diff → 依赖「首见」事件（新技术采用信号）→ changes/<date>.json
 * - 3. 快照写 deps.json + history/<date>.json；约 250 仓库 ≈ 250 请求，速率安全（5000/h）
 *
 * 边界（v1）：只读仓库根 package.json（workspace 子包、Cargo.toml、go.mod 等留作扩展）；
 * fork 仓库不抓清单（deps 为空数组，标记 fork）。
 * 运行：bun scripts/github-deps-fetch.ts（依赖 gh 已登录，token 需 repo scope）
 */
import { mkdirSync, readdirSync } from "node:fs";
import path from "node:path";

import { localDate, sourceDir, writeFileAtomic } from "./lib.ts";

const SRC = sourceDir("github-deps");
const HISTORY = path.join(SRC, "history");

interface RepoDep {
  name: string;
  version: string;
  section: "dependencies" | "devDependencies";
}

interface RepoDeps {
  repo: string;
  url: string;
  private: boolean;
  fork: boolean;
  archived: boolean;
  /** personal = 本人名下；org = 组织/协作仓（jixoai-labs 等，2026-10-04 kzf：org 项目要入图） */
  ownerType: "personal" | "org";
  pushed_at: string;
  manifestFound: boolean;
  deps: RepoDep[];
}

interface DepsSnapshot {
  fetched_at: string;
  user: string;
  count: number;
  repos: RepoDeps[];
}

interface GHRawRepo {
  full_name: string;
  html_url: string;
  private: boolean;
  fork: boolean;
  archived: boolean;
  pushed_at: string | null;
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
  const ghJson = async (
    apiPath: string,
    accept = "application/vnd.github+json",
  ): Promise<unknown> => {
    const res = await fetch(`https://api.github.com${apiPath}`, {
      headers: { ...headers, Accept: accept },
    });
    if (!res.ok)
      throw new Error(`GET ${apiPath} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
  };

  const me = (await ghJson("/user")) as { login: string };
  const login = me.login;
  const today = localDate();

  // 全部相关仓库（含私有）：owner 本人 + collaborator + organization_member
  // （2026-10-04 kzf：jixoai-labs 等 org 的项目必须入图；fork/归档仓库不抓清单）
  const repos: GHRawRepo[] = [];
  for (let page = 1; ; page++) {
    const batch = (await ghJson(
      `/user/repos?per_page=100&affiliation=owner,collaborator,organization_member&sort=pushed&page=${page}`,
    )) as GHRawRepo[];
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  const orgRepos = repos.filter((r) => !r.full_name.startsWith(`${login}/`)).length;
  console.error(`repos: ${repos.length}（本人 ${repos.length - orgRepos}，org/协作 ${orgRepos}）`);

  const out: RepoDeps[] = [];
  for (const r of repos) {
    const entry: RepoDeps = {
      repo: r.full_name,
      url: r.html_url,
      private: r.private,
      fork: r.fork,
      archived: r.archived,
      ownerType: r.full_name.startsWith(`${login}/`) ? "personal" : "org",
      pushed_at: r.pushed_at ?? "",
      manifestFound: false,
      deps: [],
    };
    if (!r.fork && !r.archived) {
      try {
        const res = await fetch(
          `https://api.github.com/repos/${r.full_name}/contents/package.json`,
          {
            headers: { ...headers, Accept: "application/vnd.github.raw" },
          },
        );
        if (res.ok) {
          const raw = await res.text();
          const pkg = JSON.parse(raw) as {
            dependencies?: Record<string, string>;
            devDependencies?: Record<string, string>;
          };
          entry.manifestFound = true;
          for (const [name, version] of Object.entries(pkg.dependencies ?? {})) {
            entry.deps.push({ name, version, section: "dependencies" });
          }
          for (const [name, version] of Object.entries(pkg.devDependencies ?? {})) {
            entry.deps.push({ name, version, section: "devDependencies" });
          }
        } else if (res.status !== 404) {
          console.error(`WARN ${r.full_name} package.json -> ${res.status}`);
        }
      } catch (err) {
        console.error(
          `WARN ${r.full_name} fetch failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    out.push(entry);
    process.stderr.write(`\r${out.length}/${repos.length}`);
  }
  process.stderr.write("\n");

  const snapshot: DepsSnapshot = {
    fetched_at: new Date().toISOString(),
    user: login,
    count: out.length,
    repos: out,
  };
  const json = JSON.stringify(snapshot, null, 1);
  mkdirSync(HISTORY, { recursive: true });
  writeFileAtomic(path.join(HISTORY, `${today}.json`), json);
  writeFileAtomic(path.join(SRC, "deps.json"), json);

  // 与上一份快照 diff → 新依赖首见事件
  const prevFiles = readdirSync(HISTORY)
    .filter((f) => f.endsWith(".json") && f !== `${today}.json`)
    .sort();
  if (prevFiles.length === 0) {
    console.log(
      `BASELINE deps scanned ${out.length} repos（含清单的见 deps.json），明日开始检测新技术采用`,
    );
    return;
  }
  const prev: DepsSnapshot = JSON.parse(
    await Bun.file(path.join(HISTORY, prevFiles.at(-1)!)).text(),
  );
  const prevMap = new Map(prev.repos.map((r) => [r.repo, r]));

  const added: { full_name: string; html_url: string; description: string; language: string }[] =
    [];
  const changed: { full_name: string; html_url: string; from: unknown; to: unknown }[] = [];
  for (const cur of snapshot.repos) {
    const p = prevMap.get(cur.repo);
    if (!p || !cur.deps.length) continue;
    const prevNames = new Set(p.deps.map((d) => d.name));
    const fresh = cur.deps.filter((d) => !prevNames.has(d.name));
    if (fresh.length) {
      for (const d of fresh) {
        added.push({
          full_name: cur.repo,
          html_url: cur.url,
          description: `首次出现依赖 ${d.name}@${d.version}（${d.section}）——新技术采用`,
          language: d.name,
        });
      }
    }
    const curNames = new Map(cur.deps.map((d) => [d.name, d.version]));
    const removed = p.deps.filter((d) => !curNames.has(d.name)).map((d) => d.name);
    const bumped = cur.deps.filter((d) =>
      p.deps.find((pd) => pd.name === d.name && pd.version !== d.version),
    ).length;
    if (removed.length || bumped) {
      changed.push({
        full_name: cur.repo,
        html_url: cur.url,
        from: { removed, note: "版本变更明细见 history 快照" },
        to: { bumpedCount: bumped },
      });
    }
  }

  const changes = {
    date: today,
    prev_date: prevFiles.at(-1)!.replace(".json", ""),
    baseline: false,
    added,
    removed: [],
    changed,
  };
  mkdirSync(path.join(SRC, "changes"), { recursive: true });
  writeFileAtomic(path.join(SRC, "changes", `${today}.json`), JSON.stringify(changes, null, 1));
  console.log(
    `deps: scanned ${out.length} repos, new deps ${added.length}, changed ${changed.length} (prev ${prevFiles.at(-1)!.replace(".json", "")})`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
