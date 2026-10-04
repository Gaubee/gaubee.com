#!/usr/bin/env bun
/**
 * tech-graph-build.ts — 技能 Graph 生成器
 *
 * 文件意图（正交意图清单）：
 * - [2026-10-03] 原始需求（kzf）：有一个「技能 Graph」——github stars、我的所有项目、项目中使用的技术都入图。
 * - 1. 节点：user/project/tech/interest-repo；边：project-uses-tech、repo-matches-star、user-stars
 * - 2. 输入：deps.json（项目→依赖）、stars.json（兴趣）、deps history 各日快照（技术首见时间线）
 * - 3. 输出 data/tech-graph.json（机器）+ data/tech-graph.md（人读：广度榜/采用时间线/项目栈/星标呼应）
 *
 * 运行：bun scripts/tech-graph-build.ts（纯本地计算，零 API）
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { DATA, sourceDir, writeFileAtomic } from "./lib.ts";

const STAR_DIR = sourceDir("github-stars");
const DEPS_DIR = sourceDir("github-deps");
// 本地图谱含私有仓信号（隐私红线）：产物进仓库外私有数据区
const OUT_JSON = path.join(DATA, "tech-graph.json");
const OUT_MD = path.join(DATA, "tech-graph.md");

interface DepEntry {
  name: string;
  version: string;
  section: string;
}
interface RepoDeps {
  repo: string;
  url: string;
  private: boolean;
  fork: boolean;
  archived: boolean;
  ownerType?: "personal" | "org";
  deps: DepEntry[];
}
interface DepsSnapshot {
  count: number;
  repos: RepoDeps[];
}
interface StarRepoLite {
  full_name: string;
  html_url: string;
  description: string;
  language: string;
  stars: number;
  order: number; // 收藏序号（1 = 最早）
}

async function main() {
  const deps: DepsSnapshot = JSON.parse(await Bun.file(path.join(DEPS_DIR, "deps.json")).text());
  const stars: { count: number; repos: StarRepoLite[] } = JSON.parse(
    await Bun.file(path.join(STAR_DIR, "stars.json")).text(),
  );

  // star 目录索引：repo 名（lowercase）→ 星标记录，用于依赖与收藏的呼应
  const starByName = new Map<string, StarRepoLite>();
  for (const s of stars.repos) starByName.set(s.full_name.toLowerCase(), s);

  // dep 名 → star 目录的映射：vite → vitejs/vite；@sveltejs/kit → sveltejs/kit
  function matchStar(depName: string): StarRepoLite | undefined {
    const bare = depName.startsWith("@") ? depName.slice(1) : depName; // @scope/pkg → scope/pkg
    const hit =
      starByName.get(bare) ??
      starByName.get(`gaubee/${bare}`) ??
      [...starByName.values()].find((s) => s.full_name.toLowerCase().endsWith(`/${bare}`));
    return hit;
  }

  // —— 图数据 ——
  const nodes: {
    id: string;
    kind: "user" | "project" | "tech";
    label: string;
    meta?: Record<string, unknown>;
  }[] = [{ id: "user:gaubee", kind: "user", label: "Gaubee (kzf)" }];
  const edges: {
    from: string;
    rel: "uses" | "stars" | "echoes";
    to: string;
    meta?: Record<string, unknown>;
  }[] = [];
  const techCount = new Map<string, number>();

  for (const r of deps.repos) {
    if (!r.deps.length) continue;
    const ownerType = r.ownerType ?? "personal";
    nodes.push({
      id: `project:${r.repo}`,
      kind: "project",
      label: r.repo,
      meta: { url: r.url, private: r.private, depsCount: r.deps.length, ownerType },
    });
    edges.push({
      from: "user:gaubee",
      rel: "uses",
      to: `project:${r.repo}`,
      meta: { as: ownerType === "personal" ? "maintains" : "contributes" },
    });
    for (const d of r.deps) {
      techCount.set(d.name, (techCount.get(d.name) ?? 0) + 1);
      edges.push({
        from: `project:${r.repo}`,
        rel: "uses",
        to: `tech:${d.name}`,
        meta: { version: d.version, section: d.section },
      });
    }
  }
  for (const [name] of techCount) {
    const star = matchStar(name);
    nodes.push({
      id: `tech:${name}`,
      kind: "tech",
      label: name,
      meta: {
        usedBy: techCount.get(name),
        starUrl: star?.html_url,
        starDesc: star?.description?.slice(0, 120),
        starCount: star?.stars,
        starOrder: star?.order, // 收藏序号（1 = 最早）
      },
    });
    if (star)
      edges.push({
        from: `tech:${name}`,
        rel: "echoes",
        to: `star:${star.full_name}`,
        meta: { note: "我在用，也 star 了" },
      });
  }
  for (const s of stars.repos) {
    nodes.push({
      id: `star:${s.full_name}`,
      kind: "tech",
      label: s.full_name,
      meta: { url: s.html_url, fromStar: true, order: s.order },
    });
    edges.push({ from: "user:gaubee", rel: "stars", to: `star:${s.full_name}` });
  }

  const orgProjects = deps.repos.filter(
    (r) => r.deps.length && (r.ownerType ?? "personal") === "org",
  ).length;
  const graph = {
    generated_at: new Date().toISOString(),
    stats: {
      projects: deps.repos.filter((r) => r.deps.length).length,
      personalProjects: deps.repos.filter(
        (r) => r.deps.length && (r.ownerType ?? "personal") === "personal",
      ).length,
      orgProjects,
      techs: techCount.size,
      stars: stars.count,
      edges: edges.length,
    },
    nodes,
    edges,
    timeline: [] as [string, string][],
    timelineMeta: { baselineDate: "", baselineCount: 0 },
  };
  // —— 技术首见时间线 ——
  // 语义（2026-10-04 修 BUG）：只统计「跟踪开始后」新增的依赖。最老的快照是基线存量，
  // 把它计入会把全库依赖都标成基线日（伪首见）——存量单独计数，不进时间线。
  const firstSeen = new Map<string, string>();
  const histDir = path.join(DEPS_DIR, "history");
  let baselineCount = 0;
  let baselineDate = "";
  if (existsSync(histDir)) {
    const files = readdirSync(histDir)
      .filter((f) => f.endsWith(".json"))
      .sort();
    if (files.length > 0) {
      baselineDate = files[0].replace(".json", "");
      const baselineSnap: DepsSnapshot = JSON.parse(
        await Bun.file(path.join(histDir, files[0])).text(),
      );
      baselineCount = new Set(baselineSnap.repos.flatMap((r) => r.deps.map((d) => d.name))).size;
    }
    for (const f of files.slice(1)) {
      const snap: DepsSnapshot = JSON.parse(await Bun.file(path.join(histDir, f)).text());
      for (const r of snap.repos) {
        for (const d of r.deps) {
          if (!firstSeen.has(d.name)) firstSeen.set(d.name, f.replace(".json", ""));
        }
      }
    }
  }
  const timeline = [...firstSeen.entries()].sort((a, b) => (a[1] < b[1] ? 1 : -1)).slice(0, 25);

  // 时间线进机器版 JSON（osapp 的采用时间线组件数据源；2026-10-04）
  graph.timeline = timeline;
  graph.timelineMeta = { baselineDate, baselineCount };
  writeFileAtomic(OUT_JSON, JSON.stringify(graph, null, 1));

  // —— 人读版 ——
  const breadth = [...techCount.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]);
  const echoed = [...techCount.keys()]
    .map((n) => ({ name: n, star: matchStar(n) }))
    .filter((x) => x.star);
  const lines: string[] = [
    "# 技能 Graph（技能与技术的关联地图）",
    "",
    `> 生成于 ${new Date().toISOString()} · 重建：bun scripts/tech-graph-build.ts · 机器版 data/tech-graph.json`,
    "",
    "## 总览",
    "",
    `- 项目：**${graph.stats.projects}** 个（owner 仓库，非 fork 非 archived，有 package.json 的）`,
    `- 依赖技术：**${graph.stats.techs}** 个不同包`,
    `- 星标收藏：**${graph.stats.stars}** 项`,
    `- 图边数：${graph.stats.edges}`,
    "",
    "## 技术广度榜（被 ≥2 个项目使用）",
    "",
    ...(breadth.length
      ? breadth.map(([name, n]) => {
          const star = matchStar(name);
          return `- **${name}** × ${n} 项目${star ? ` · ★也收藏了 [${star.full_name}](${star.html_url})` : ""}`;
        })
      : ["（暂无）"]),
    "",
    "## 新技术采用时间线（跟踪期内新增依赖，最近 25 条）",
    "",
    ...(timeline.length
      ? timeline.map(([name, date]) => `- ${date} · ${name}`)
      : [
          `（依赖跟踪自 ${baselineDate} 开始：当前 ${baselineCount} 项技术均为跟踪前存量，不算"采用事件"；`,
          "各仓库依赖发生新增的当天，会以「新技术采用」条目出现在这里与日报中）",
        ]),
    "",
    "## 用着且收藏了的（star 呼应——真正的核心技能区）",
    "",
    ...echoed
      .slice(0, 40)
      .map(
        ({ name, star }) =>
          `- **${name}** — 在项目中使用 · 收藏 [${star!.full_name}](${star!.html_url})（${star!.description?.slice(0, 80) || "无描述"}）`,
      ),
    "",
    "## 项目技术栈",
    "",
    ...deps.repos
      .filter((r) => r.deps.length)
      .map(
        (r) =>
          `- [${r.repo}](${r.url})：${r.deps
            .map((d) => d.name)
            .slice(0, 18)
            .join("、")}${r.deps.length > 18 ? " …" : ""}`,
      ),
    "",
  ];
  writeFileAtomic(OUT_MD, lines.join("\n"));

  console.log(
    `tech-graph: ${graph.stats.projects} projects × ${graph.stats.techs} techs × ${graph.stats.stars} stars, ${graph.stats.edges} edges`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
