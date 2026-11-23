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

/** X 动态检索 */
export function searchX(items: XItem[], query: string): XItem[] {
  const kws = query
    .toLowerCase()
    .split(/[\s,，、]+/)
    .filter(Boolean);
  const out = kws.length
    ? items.filter((it) => {
        const hay = `${it.text} ${it.zh ?? ""} ${it.author}`.toLowerCase();
        return kws.every((k) => hay.includes(k));
      })
    : items;
  return out;
}
