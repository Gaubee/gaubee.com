/**
 * tools-data.ts — 工具集应用的数据加载与纯前端查询
 *
 * 数据全部来自站点静态目录 `static/tools/` 下的公开投影（构建后路径为 `/tools/`）（由 scripts/build-tools-data.ts 生成）：
 *   index.json  工具清单（只含公开字段）
 *   stars.json  1814 个收藏（仓库名/描述/语言/星数/收藏日）
 *   deps.json   公开仓的依赖（已剔私有仓）
 *   x.json      X 动态（id/作者/时间/正文/译文）
 *
 * 隐私契约：这里不读也不该读 `~/.gaubee-skills`；所有查询都在浏览器里完成。
 */

export interface ToolMeta {
  id: string;
  name: string;
  summary: string;
  form: "webapp" | "self-hosted";
  version: string;
  updatedAt: string;
  dataNeeds: string[];
  repo?: string;
  dataFile?: string;
}

export interface ToolIndex {
  generatedAt: string;
  count: number;
  tools: ToolMeta[];
}

export interface StarRepo {
  name: string;
  url: string;
  desc: string;
  lang: string;
  stars: number;
  at: string;
  topics: string[];
  archived: boolean;
}

export interface DepRepo {
  repo: string;
  deps: Array<{ name: string; v: string; sec: string }>;
}

export interface XItem {
  id: string;
  author: string;
  kind: string;
  at: string;
  text: string;
  zh?: string;
  /** 引用帖的原帖（2026-11-25）：搜索与交叉工具也要能命中引用内容 */
  quote?: { author: string; text: string; url?: string };
}

import { base } from "$app/paths";

const cache = new Map<string, unknown>();

async function loadJson<T>(url: string): Promise<T | null> {
  if (cache.has(url)) return cache.get(url) as T;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const j = (await res.json()) as T;
    cache.set(url, j);
    return j;
  } catch {
    return null;
  }
}

export const loadIndex = (): Promise<ToolIndex | null> => loadJson<ToolIndex>(`${base}/tools/index.json`);
export const loadStars = (): Promise<{ count: number; repos: StarRepo[] } | null> =>
  loadJson(`${base}/tools/data/stars.json`);
export const loadDeps = (): Promise<{ count: number; repos: DepRepo[] } | null> =>
  loadJson(`${base}/tools/data/deps.json`);
export const loadX = (): Promise<{ count: number; items: XItem[] } | null> =>
  loadJson(`${base}/tools/data/x.json`);

/** 收藏检索：多关键词 AND，仓库名权重最高 */
export function searchStars(repos: StarRepo[], query: string, opts: { lang?: string; archived?: boolean | null } = {}): StarRepo[] {
  const kws = query
    .toLowerCase()
    .split(/[\s,，、]+/)
    .filter(Boolean);
  let out = repos;
  if (kws.length) {
    out = repos.filter((r) => {
      const hay = `${r.name} ${r.desc} ${r.topics.join(" ")}`.toLowerCase();
      return kws.every((k) => hay.includes(k));
    });
  }
  if (opts.lang) out = out.filter((r) => r.lang.toLowerCase() === opts.lang!.toLowerCase());
  if (opts.archived === true) out = out.filter((r) => r.archived);
  if (opts.archived === false) out = out.filter((r) => !r.archived);
  return out.sort((a, b) => b.stars - a.stars);
}

/** 依赖溯源：某个包被哪些公开仓使用 */
export function findDep(repos: DepRepo[], pkg: string): DepRepo[] {
  const q = pkg.trim().toLowerCase();
  if (!q) return [];
  return repos
    .map((r) => ({ repo: r.repo, deps: r.deps.filter((d) => d.name.toLowerCase().includes(q)) }))
    .filter((r) => r.deps.length > 0);
}

/** 收藏时间线：按日聚合新增与累计 */
export function starTimeline(repos: StarRepo[], sinceDays = 90): Array<{ date: string; added: number; total: number }> {
  const byDay = new Map<string, number>();
  for (const r of repos) if (r.at) byDay.set(r.at, (byDay.get(r.at) ?? 0) + 1);
  const dates = [...byDay.keys()].sort();
  let cum = 0;
  const all = dates.map((d) => {
    cum += byDay.get(d)!;
    return { date: d, added: byDay.get(d)!, total: cum };
  });
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - sinceDays);
  const since = cutoff.toLocaleDateString("sv-SE");
  return all.filter((x) => x.date >= since);
}

/** X 动态检索（含引用帖原帖，2026-11-25） */
export function searchX(items: XItem[], query: string): XItem[] {
  const kws = query
    .toLowerCase()
    .split(/[\s,，、]+/)
    .filter(Boolean);
  const out = kws.length
    ? items.filter((it) => {
        const hay =
          `${it.text} ${it.zh ?? ""} ${it.author} ${it.quote?.author ?? ""} ${it.quote?.text ?? ""}`.toLowerCase();
        return kws.every((k) => hay.includes(k));
      })
    : items;
  return out;
}

// ---------- 主题漂移（stars-drift 升级） ----------

export interface TopicDrift {
  days: number;
  window: number;
  prev: number;
  topics: Array<{ topic: string; recent: number; prior: number; delta: number }>;
  languages: Array<{ lang: string; recent: number; prior: number }>;
}

/** 主题与语言的双窗口漂移：最近 days 天 vs 前一个 days 天 */
export function topicDrift(repos: StarRepo[], days = 30): TopicDrift {
  const cut = new Date();
  cut.setDate(cut.getDate() - days);
  const cut2 = new Date();
  cut2.setDate(cut2.getDate() - days * 2);
  const recent: StarRepo[] = [];
  const prior: StarRepo[] = [];
  for (const r of repos) {
    if (!r.at) continue;
    const t = Date.parse(r.at);
    if (t >= cut.getTime()) recent.push(r);
    else if (t >= cut2.getTime()) prior.push(r);
  }
  const count = (list: StarRepo[], key: (r: StarRepo) => string[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const r of list) for (const k of key(r)) m.set(k, (m.get(k) ?? 0) + 1);
    return m;
  };
  const tc = count(recent, (r) => (r.topics ?? []).map((t) => t.toLowerCase()));
  const tp = count(prior, (r) => (r.topics ?? []).map((t) => t.toLowerCase()));
  const topics = [...new Set([...tc.keys(), ...tp.keys()])]
    .map((topic) => ({ topic, recent: tc.get(topic) ?? 0, prior: tp.get(topic) ?? 0 }))
    .map((x) => ({ ...x, delta: x.recent - x.prior }))
    .filter((x) => x.recent >= 2)
    .sort((a, b) => b.delta - a.delta || b.recent - a.recent)
    .slice(0, 20);
  const lc = count(recent, (r) => (r.lang ? [r.lang] : []));
  const lp = count(prior, (r) => (r.lang ? [r.lang] : []));
  const languages = [...new Set([...lc.keys(), ...lp.keys()])]
    .map((lang) => ({ lang, recent: lc.get(lang) ?? 0, prior: lp.get(lang) ?? 0 }))
    .filter((x) => x.recent > 0)
    .sort((a, b) => b.recent - a.recent)
    .slice(0, 8);
  return { days, window: recent.length, prev: prior.length, topics, languages };
}

// ---------- 收藏 × 动态交叉（star-x-cross） ----------

export interface CrossHit {
  repo: StarRepo;
  count: number;
  latest: string;
  authors: string[];
  sample: string;
}
export interface CrossCandidate {
  repo: string;
  count: number;
  latest: string;
  authors: string[];
  sample: string;
}
export interface StarXCross {
  stars: number;
  posts: number;
  hitCount: number;
  mentionCount: number;
  hits: CrossHit[];
  candidates: CrossCandidate[];
}

const RESERVED_OWNERS = new Set([
  "about", "apps", "assets", "collections", "contact", "dashboard", "enterprise", "explore",
  "features", "github", "join", "login", "marketplace", "new", "notifications", "orgs", "pricing",
  "readme", "search", "security", "settings", "site", "sponsors", "team", "teams", "topics",
  "trending", "users",
]);

function normalizeRepoName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\.git$/i, "")
    .replace(/[).,，。；;:：!?！？'"’”]+$/g, "");
}

/**
 * 收藏 × 动态交叉：X 正文提到过的收藏仓，以及提到但尚未收藏的 GitHub 仓库。
 * 裸写的 owner/repo 只在命中收藏时才计入（避免误报）；候选只认显式 github.com 链接。
 */
export function starXCross(repos: StarRepo[], items: XItem[], query = ""): StarXCross {
  const starMap = new Map(repos.map((r) => [r.name.toLowerCase(), r]));
  const known = new Set(starMap.keys());
  const mentions: Array<{ name: string; item: XItem }> = [];
  const candidates = new Map<string, { count: number; latest: string; authors: Set<string>; sample: string }>();

  for (const it of items) {
    // 引用帖的原帖也算正文（2026-11-25）：「有人试过吗」+ 原帖链接才是完整信号
    const text = `${it.text ?? ""}\n${it.quote?.text ?? ""}`;
    if (!text.trim()) continue;
    const seen = new Set<string>();
    for (const m of text.matchAll(/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/g)) {
      if (RESERVED_OWNERS.has(m[1]!.toLowerCase())) continue;
      const name = normalizeRepoName(`${m[1]}/${m[2]}`);
      if (seen.has(name)) continue;
      seen.add(name);
      if (known.has(name)) {
        mentions.push({ name, item: it });
      } else {
        const c = candidates.get(name) ?? { count: 0, latest: "", authors: new Set<string>(), sample: text };
        c.count += 1;
        if ((it.at ?? "") > c.latest) c.latest = it.at ?? "";
        if (it.author) c.authors.add(it.author);
        candidates.set(name, c);
      }
    }
    for (const m of text.matchAll(/(?:^|[^A-Za-z0-9_./-])([A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*)/g)) {
      const name = normalizeRepoName(m[1]!);
      if (!known.has(name) || seen.has(name)) continue;
      seen.add(name);
      mentions.push({ name, item: it });
    }
  }

  const byRepo = new Map<string, Array<{ name: string; item: XItem }>>();
  for (const m of mentions) {
    const list = byRepo.get(m.name) ?? [];
    list.push(m);
    byRepo.set(m.name, list);
  }
  const q = query.trim().toLowerCase();
  let hits: CrossHit[] = [...byRepo.entries()].map(([name, list]) => {
    const repo = starMap.get(name)!;
    return {
      repo,
      count: list.length,
      latest: list.map((x) => x.item.at ?? "").sort().at(-1) ?? "",
      authors: [...new Set(list.map((x) => x.item.author))],
      sample: `${list[0]!.item.zh ?? list[0]!.item.text}${
        list[0]!.item.quote ? ` ｜ 引用 @${list[0]!.item.quote.author}：${list[0]!.item.quote.text}` : ""
      }`,
    };
  });
  if (q) {
    hits = hits.filter((h) => {
      const hay = `${h.repo.name} ${h.repo.desc} ${h.repo.topics.join(" ")} ${h.authors.join(" ")} ${h.sample}`.toLowerCase();
      return hay.includes(q);
    });
  }
  hits.sort((a, b) => b.count - a.count || b.latest.localeCompare(a.latest));

  let candidateList: CrossCandidate[] = [...candidates.entries()].map(([name, c]) => ({
    repo: name,
    count: c.count,
    latest: c.latest,
    authors: [...c.authors],
    sample: c.sample,
  }));
  if (q) candidateList = candidateList.filter((c) => `${c.repo} ${c.sample} ${c.authors.join(" ")}`.toLowerCase().includes(q));
  candidateList.sort((a, b) => b.count - a.count || b.latest.localeCompare(a.latest));

  return {
    stars: repos.length,
    posts: items.length,
    hitCount: hits.length,
    mentionCount: hits.reduce((n, h) => n + h.count, 0),
    hits: hits.slice(0, 30),
    candidates: candidateList.slice(0, 20),
  };
}
