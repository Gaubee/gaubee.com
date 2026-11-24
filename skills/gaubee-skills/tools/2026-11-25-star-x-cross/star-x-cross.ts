#!/usr/bin/env bun
/**
 * star-x-cross — 收藏 × X 动态 交叉命中（webapp）
 *
 * 背景（2026-11-25）：kzf 常问「我是不是点赞/收藏过一个 X 的东西」。收藏与动态是两套
 * 独立数据：GitHub 星标回答「我留下了什么」，X 点赞回答「我被推送过什么」。此前只能
 * 分别搜（stars-search / x-search），交集要人肉对。
 *
 * 本工具做两件事，全部在本地算：
 *  1. 收藏 ∩ 动态：X 正文里提到过的、我收藏过的仓库（带动态条数、最近日期、作者）
 *  2. 动态里出现但尚未收藏的 GitHub 仓库（发现候选；只认显式 github.com/owner/repo
 *     链接，避免 owner/repo 裸写带来的误报）
 *
 * 匹配口径：
 *  - 显式链接 `github.com/<owner>/<repo>` 一律收，repo 段落截断到两段（tree/issues 等子路径忽略）
 *  - 裸写的 `owner/repo` 只在「该仓库确实在收藏里」时计入方向 1（高精度）
 *
 * 用法：bun tools/2026-11-25-star-x-cross/star-x-cross.ts [关键词] [--days N] [--json]
 * 退出码：0 正常；2 数据缺失。
 */
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = process.env.GAUBEE_SKILLS_DATA ?? path.join(os.homedir(), ".gaubee-skills", "data");
const STARS = path.join(DATA, "sources", "github-stars", "stars.json");
const XSTORE = path.join(DATA, "sources", "x-likes", "x.json");

interface Star {
  full_name?: string;
  description?: string;
  language?: string;
  stars?: number;
  starred_at?: string;
  topics?: string[];
}
interface XItem {
  id: string;
  author?: string;
  kind?: string;
  created_at?: string;
  text?: string;
}

// github.com 的一级路径不是仓库 owner，统一跳过
const RESERVED = new Set([
  "about", "apps", "assets", "collections", "contact", "dashboard", "enterprise", "explore",
  "features", "github", "join", "login", "marketplace", "new", "notifications", "orgs", "pricing",
  "readme", "search", "security", "settings", "site", "sponsors", "team", "teams", "topics",
  "trending", "users",
]);

function normalizeRepo(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\.git$/i, "")
    .replace(/[).,，。；;:：!?！？'"’”]+$/g, "");
}

function explicitRefs(text: string): string[] {
  const out: string[] = [];
  const re = /github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/g;
  for (const m of text.matchAll(re)) {
    const owner = m[1]!;
    const repo = m[2]!;
    if (RESERVED.has(owner.toLowerCase())) continue;
    out.push(normalizeRepo(`${owner}/${repo}`));
  }
  return out;
}

function bareRefs(text: string, known: Set<string>): string[] {
  const out: string[] = [];
  // 前后不允许紧挨 URL 字符，避免把 https://host/a/b 的尾巴当成 owner/repo
  const re = /(?:^|[^A-Za-z0-9_./-])([A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*)/g;
  for (const m of text.matchAll(re)) {
    const t = normalizeRepo(m[1]!);
    if (known.has(t)) out.push(t);
  }
  return out;
}

interface Mention {
  repo: string;
  postId: string;
  author: string;
  kind: string;
  at: string;
  text: string;
  via: "link" | "mention";
}

function main(): number {
  if (!existsSync(STARS) || !existsSync(XSTORE)) {
    console.error(`数据缺失：${STARS} 或 ${XSTORE}`);
    return 2;
  }
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const daysIdx = argv.indexOf("--days");
  const days = daysIdx >= 0 ? Math.max(1, Number(argv[daysIdx + 1] ?? 30) || 30) : 0;
  const query = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--days") ?? "";

  const rawStars = JSON.parse(readFileSync(STARS, "utf8")) as { repos?: Star[] };
  const stars = (rawStars.repos ?? []).filter((s) => s.full_name);
  const starMap = new Map<string, Star>();
  for (const s of stars) starMap.set(s.full_name!.toLowerCase(), s);

  const rawX = JSON.parse(readFileSync(XSTORE, "utf8")) as { items?: Record<string, XItem> };
  let items = Object.values(rawX.items ?? {});
  if (days > 0) {
    const cut = Date.now() - days * 86400000;
    items = items.filter((it) => it.created_at && Date.parse(it.created_at) >= cut);
  }

  const known = new Set(starMap.keys());
  const mentions: Mention[] = [];
  const candidates = new Map<string, { count: number; latest: string; authors: Set<string>; sample: string }>();

  for (const it of items) {
    const text = it.text ?? "";
    if (!text) continue;
    const explicit = explicitRefs(text);
    const bare = bareRefs(text, known);
    const seen = new Set<string>();

    for (const repo of explicit) {
      if (seen.has(repo)) continue;
      seen.add(repo);
      if (starMap.has(repo)) {
        mentions.push({
          repo,
          postId: it.id,
          author: it.author ?? "",
          kind: it.kind ?? "",
          at: it.created_at?.slice(0, 10) ?? "",
          text,
          via: "link",
        });
      } else {
        const c = candidates.get(repo) ?? { count: 0, latest: "", authors: new Set<string>(), sample: text };
        c.count += 1;
        if ((it.created_at ?? "") > c.latest) c.latest = it.created_at?.slice(0, 10) ?? "";
        if (it.author) c.authors.add(it.author);
        candidates.set(repo, c);
      }
    }
    for (const repo of bare) {
      if (seen.has(repo)) continue;
      seen.add(repo);
      mentions.push({
        repo,
        postId: it.id,
        author: it.author ?? "",
        kind: it.kind ?? "",
        at: it.created_at?.slice(0, 10) ?? "",
        text,
        via: "mention",
      });
    }
  }

  const hits = [...new Set(mentions.map((m) => m.repo))]
    .map((repo) => {
      const ms = mentions.filter((m) => m.repo === repo);
      const latest = ms.map((m) => m.at).sort().at(-1) ?? "";
      return { repo, star: starMap.get(repo)!, mentions: ms, latest };
    })
    .sort((a, b) => b.mentions.length - a.mentions.length || b.latest.localeCompare(a.latest));

  const q = query.trim().toLowerCase();
  const filteredHits = q
    ? hits.filter((h) => {
        const s = h.star;
        const hay = `${h.repo} ${s.description ?? ""} ${(s.topics ?? []).join(" ")} ${h.mentions.map((m) => m.text).join(" ")}`.toLowerCase();
        return hay.includes(q);
      })
    : hits;

  const candidateList = [...candidates.entries()]
    .map(([repo, c]) => ({ repo, ...c, authors: [...c.authors] }))
    .filter((c) => !q || `${c.repo} ${c.sample} ${c.authors.join(" ")}`.toLowerCase().includes(q))
    .sort((a, b) => b.count - a.count || b.latest.localeCompare(a.latest));

  if (json) {
    console.log(
      JSON.stringify(
        {
          stars: stars.length,
          posts: items.length,
          hits: filteredHits.slice(0, 50).map((h) => ({
            repo: h.repo,
            description: h.star.description ?? "",
            language: h.star.language ?? "",
            stars: h.star.stars ?? 0,
            count: h.mentions.length,
            latest: h.latest,
            authors: [...new Set(h.mentions.map((m) => m.author))],
            sample: h.mentions[0]?.text.slice(0, 200) ?? "",
          })),
          candidates: candidateList.slice(0, 50).map((c) => ({
            repo: c.repo,
            count: c.count,
            latest: c.latest,
            authors: c.authors,
            sample: c.sample.slice(0, 200),
          })),
        },
        null,
        2,
      ),
    );
    return 0;
  }

  console.log(
    `star-x-cross：收藏 ${stars.length} · X ${items.length} 条动态${days ? `（最近 ${days} 天）` : ""}${q ? ` · 过滤「${query}」` : ""}`,
  );
  console.log(`收藏 ∩ 动态：${filteredHits.length} 个仓库在 X 里被提过，共 ${filteredHits.reduce((n, h) => n + h.mentions.length, 0)} 条动态`);
  console.log("");

  for (const h of filteredHits.slice(0, 15)) {
    const s = h.star;
    const authors = [...new Set(h.mentions.map((m) => `@${m.author}`))].slice(0, 3).join("、");
    console.log(
      `  ${h.repo}  ★${s.stars ?? 0} ${s.language ?? ""} — ${h.mentions.length} 条（最近 ${h.latest || "?"} · ${authors || "?"}）`,
    );
    if (s.description) console.log(`      ${s.description.slice(0, 100)}`);
    console.log(`      样例：${(h.mentions[0]?.text ?? "").replace(/\s+/g, " ").slice(0, 100)}`);
  }
  if (filteredHits.length === 0) console.log("  （无命中）");

  console.log("");
  console.log(`动态里出现、尚未收藏：${candidateList.length} 个`);
  for (const c of candidateList.slice(0, 12)) {
    console.log(`  ${c.repo} — ${c.count} 条（最近 ${c.latest || "?"} · ${c.authors.slice(0, 2).map((a) => `@${a}`).join("、")}）`);
  }
  if (candidateList.length === 0) console.log("  （无）");
  return 0;
}

process.exit(main());
