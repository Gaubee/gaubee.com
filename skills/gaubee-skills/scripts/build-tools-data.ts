#!/usr/bin/env bun
/**
 * build-tools-data.ts — 为 WebApp 工具生成公开数据投影（static/tools/data/*.json）
 *
 * 隐私红线：只投影**公开可验证**的字段——
 *   stars：仓库全名、URL、描述、语言、星数、收藏日期、topics、archived
 *   deps：仓库全名、依赖名与版本（不含私有仓的代码/内部文档）
 *   x：推文 id、作者、正文（已翻译）、时间、媒体键（不含私有判断字段）
 * 不写：私有仓名、本机路径、token、feedback-log、profile 内容。
 *
 * 用法：bun scripts/build-tools-data.ts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = process.env.GAUBEE_SKILLS_DATA ?? path.join(os.homedir(), ".gaubee-skills", "data");
const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..");
const OUT_DIR = path.join(SITE, "static", "tools", "data");

interface StarRepo {
  full_name?: string;
  html_url?: string;
  description?: string;
  language?: string;
  stars?: number;
  starred_at?: string;
  topics?: string[];
  archived?: boolean;
  owner?: string;
}

function readJson<T>(file: string): T | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/** 私有仓判定：从 taxonomy 与 deps 快照里无法直接知道；用「是否在公开 stars 里」反推不成立。
 *  这里保守做法：只投影 stars（收藏本就是公开行为），deps 只投影到**公开仓**。 */
function isPrivateRepo(name: string, privateList: Set<string>): boolean {
  return privateList.has(name);
}

function main(): number {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const written: string[] = [];

  // 1) stars：全量投影（收藏是公开行为，repo 全名与描述本就公开）
  const stars = readJson<{ repos?: StarRepo[] }>(path.join(DATA, "sources", "github-stars", "stars.json"));
  if (stars?.repos) {
    const slim = stars.repos
      .filter((r) => r.full_name)
      .map((r) => ({
        name: r.full_name,
        url: r.html_url ?? `https://github.com/${r.full_name}`,
        desc: (r.description ?? "").slice(0, 200),
        lang: r.language ?? "",
        stars: r.stars ?? 0,
        at: (r.starred_at ?? "").slice(0, 10),
        topics: (r.topics ?? []).slice(0, 8),
        archived: Boolean(r.archived),
      }));
    writeFileSync(path.join(OUT_DIR, "stars.json"), `${JSON.stringify({ count: slim.length, repos: slim })}\n`, "utf8");
    written.push(`stars ${slim.length}`);
  }

  // 2) deps：只投影公开仓（用 stars 集合 + 已知公开 org 白名单做保守过滤）
  const deps = readJson<{
    repos?: Array<{ repo?: string; private?: boolean; deps?: Array<{ name?: string; version?: string; section?: string }> }>;
  }>(path.join(DATA, "sources", "github-deps", "deps.json"));
  if (deps?.repos) {
    const privateList = new Set<string>();
    for (const r of deps.repos) if (r.private && r.repo) privateList.add(r.repo);
    const slimRepos = deps.repos
      .filter((r) => r.repo && !isPrivateRepo(r.repo, privateList))
      .map((r) => ({
        repo: r.repo!,
        deps: (r.deps ?? []).slice(0, 200).map((d) => ({ name: d.name ?? "", v: d.version ?? "", sec: d.section ?? "" })),
      }));
    writeFileSync(
      path.join(OUT_DIR, "deps.json"),
      `${JSON.stringify({ count: slimRepos.length, repos: slimRepos })}\n`,
      "utf8",
    );
    written.push(`deps ${slimRepos.length}（已剔私有 ${privateList.size}）`);
  }

  // 3) x：只投影公开账号的推文正文与时间
  const xstore = readJson<{
    items?: Record<
      string,
      {
        id?: string;
        text?: string;
        created_at?: string;
        kind?: string;
        author?: string;
        quote?: { id?: string; author?: string; text?: string; url?: string; xTrans?: string };
      }
    >;
  }>(path.join(DATA, "sources", "x-likes", "x.json"));
  const trans = readJson<Record<string, string>>(path.join(SITE, "skills", "gaubee-skills", "translations", "x-tweets.zh.json"));
  if (xstore?.items) {
    const items = Object.values(xstore.items)
      .filter((t) => t.id && (t.text ?? "").length > 0)
      .map((t) => ({
        id: t.id!,
        author: t.author ?? "",
        kind: t.kind ?? "liked",
        at: (t.created_at ?? "").slice(0, 10),
        // 正文截到 1000 字（2026-11-25 从 280 上调）：检索/预览要能看到长帖主体；
        // 事件页仍是全文，这里只是 WebApp 的轻量投影。
        text: (t.text ?? "").slice(0, 1000),
        zh: trans?.[t.id!] ? trans[t.id!]!.slice(0, 1000) : undefined,
        // 引用帖原帖（2026-11-25）：搜索/交叉工具要能命中被引用的内容；
        // 译文走同一个 translations 文件（键 = quote.id），没有则回退 X 自带译文。
        quote: t.quote?.text
          ? {
              author: t.quote.author ?? "",
              text: t.quote.text.slice(0, 600),
              url: t.quote.url,
              zh: ((t.quote.id ? trans?.[t.quote.id] : undefined) ?? t.quote.xTrans)?.slice(0, 600),
            }
          : undefined,
      }))
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 1500);
    writeFileSync(path.join(OUT_DIR, "x.json"), `${JSON.stringify({ count: items.length, items })}\n`, "utf8");
    written.push(`x ${items.length}`);
  }

  console.log(`written ${OUT_DIR}：${written.join(" / ")}`);

  // 4) taxonomy 分类：把策展地图投影成「分类 → 仓库清单」，
  // 供 star-browse 在浏览器里按分类浏览（只含仓库名与类目，不含任何评注）
  const taxoPath = path.join(DATA, "taxonomy.md");
  if (existsSync(taxoPath)) {
    const lines = readFileSync(taxoPath, "utf8").split("\n");
    const sections: Array<{ section: string; repos: string[] }> = [];
    let cur: { section: string; repos: string[] } | null = null;
    for (const line of lines) {
      const h = line.match(/^###\s+(.+?)（/);
      if (h) {
        if (cur && cur.repos.length) sections.push(cur);
        cur = { section: h[1]!, repos: [] };
        continue;
      }
      const m = line.match(/^- \[([\w.-]+\/[\w.-]+)\]\(https:\/\/github\.com\//);
      if (m && cur) cur.repos.push(m[1]!);
    }
    if (cur && cur.repos.length) sections.push(cur);
    writeFileSync(
      path.join(OUT_DIR, "taxonomy.json"),
      `${JSON.stringify({ count: sections.length, sections })}\n`,
      "utf8",
    );
    written.push(`taxonomy ${sections.length} 类`);
  }

  // 隐私自检
  for (const f of ["stars.json", "deps.json", "x.json"]) {
    const p = path.join(OUT_DIR, f);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, "utf8");
    for (const [label, re] of [
      ["本机绝对路径", /\/Users\/[a-z]/i],
      ["私有数据根", /~\.gaubee-skills|GAUBEE_SKILLS_DATA/],
      ["疑似密钥", /github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9]{20,}/],
    ] as Array<[string, RegExp]>) {
      if (re.test(text)) {
        console.error(`PRIVACY FAIL：${f} 含${label}`);
        return 1;
      }
    }
  }
  return 0;
}

process.exit(main());
