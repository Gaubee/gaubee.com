#!/usr/bin/env bun
/**
 * sync-site-graph.ts — 把技能 Graph 同步为站点 public 视图（写入 gaubee.com 仓库）
 *
 * 文件意图（正交意图清单）：
 * - [2026-10-04] kzf：skill-graph 作为 gaubeeOS 的 osapp 上站点；数据静态、由 gaubee-skills 管道维护。
 * - 隐私红线（2026-10-03 事故教训）：站点是发布视图——本地 tech-graph.json 含私有仓信号，
 *   必须投影：私有 project 节点整体剔除（含其 uses 边），tech 的 usedBy 按存活项目重算，
 *   仅被私有项目使用且无星标呼应的 tech 连带剔除。断言产物零 private 节点。
 * - 产物：紧凑 JSON（省 30-40% 体积），运行时由 osapp fetch，不进 JS bundle。
 *
 * 运行：bun scripts/sync-site-graph.ts [--site /Users/kzf/Dev/Github/gaubee.com]
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import { DATA, writeFileAtomic } from "./lib.ts";

// skill 已迁入站点仓库（2026-10-05）：默认仓库根 = scripts 上三级；--site 可覆盖
const SITE = (() => {
  const i = process.argv.indexOf("--site");
  return i > 0 ? process.argv[i + 1] : path.resolve(import.meta.dir, "..", "..", "..");
})();
const OUT = `${SITE}/static/skill-graph/data.json`;

interface GNode {
  id: string;
  kind: "user" | "project" | "tech";
  label: string;
  meta?: Record<string, unknown>;
}
interface GEdge {
  from: string;
  rel: string;
  to: string;
  meta?: Record<string, unknown>;
}

async function main() {
  const graph = JSON.parse(await Bun.file(path.join(DATA, "tech-graph.json")).text()) as {
    generated_at: string;
    stats: Record<string, number>;
    nodes: GNode[];
    edges: GEdge[];
    timeline?: [string, string][];
    timelineMeta?: { baselineDate: string; baselineCount: number };
  };

  const keep = new Set<string>();
  for (const n of graph.nodes) {
    if (n.kind === "project" && n.meta?.private === true) continue; // 私有项目整体出局
    keep.add(n.id);
  }
  const nodes = graph.nodes.filter((n) => keep.has(n.id));

  // 存活 uses 边决定 tech 的 usedBy
  const usedBy = new Map<string, number>();
  for (const e of graph.edges) {
    if (e.rel !== "uses" || !keep.has(e.from) || !keep.has(e.to)) continue;
    if (e.from.startsWith("project:") && e.to.startsWith("tech:")) {
      usedBy.set(e.to, (usedBy.get(e.to) ?? 0) + 1);
    }
  }
  // tech 去留：有公开项目在用，或有星标呼应（echoes 目标必为公开 star）
  const techKeep = new Set<string>();
  for (const n of nodes) {
    if (n.kind !== "tech") continue;
    if (String(n.id).startsWith("star:")) {
      techKeep.add(n.id);
      continue;
    }
    if (
      (usedBy.get(n.id) ?? 0) > 0 ||
      graph.edges.some((e) => e.rel === "echoes" && e.from === n.id)
    ) {
      techKeep.add(n.id);
    }
  }
  const finalKeep = new Set([...keep].filter((id) => !id.startsWith("tech:") || techKeep.has(id)));
  const outNodes = graph.nodes
    .filter((n) => finalKeep.has(n.id))
    .map((n) =>
      n.kind === "tech" && !String(n.id).startsWith("star:")
        ? { ...n, meta: { ...n.meta, usedBy: usedBy.get(n.id) ?? 0 } }
        : n,
    );
  const outEdges = graph.edges.filter((e) => finalKeep.has(e.from) && finalKeep.has(e.to));

  const projNodes = outNodes.filter((n) => n.kind === "project");
  const stats = {
    projects: projNodes.length,
    personalProjects: projNodes.filter((n) => (n.meta?.ownerType ?? "personal") === "personal")
      .length,
    orgProjects: projNodes.filter((n) => n.meta?.ownerType === "org").length,
    techs: outNodes.filter((n) => n.kind === "tech" && !String(n.id).startsWith("star:")).length,
    stars: outNodes.filter((n) => String(n.id).startsWith("star:")).length,
    edges: outEdges.length,
  };
  const out = {
    view: "public",
    generated_at: new Date().toISOString(),
    stats,
    nodes: outNodes,
    edges: outEdges,
    // 采用时间线只有「技术名 + 日期」，无仓库归属，可直接公开
    timeline: graph.timeline ?? [],
    timelineMeta: graph.timelineMeta ?? { baselineDate: "", baselineCount: 0 },
  };

  // 发布断言：private 节点必须为零（红线门）
  const leaked = outNodes.filter((n) => n.kind === "project" && n.meta?.private === true);
  if (leaked.length) {
    console.error(
      `PRIVACY-LEAK: ${leaked.length} private project nodes survived: ${leaked
        .slice(0, 5)
        .map((n) => n.id)
        .join(", ")}`,
    );
    process.exit(1);
  }

  const json = JSON.stringify(out); // 紧凑：站点视图不 pretty-print
  mkdirSync(path.dirname(OUT), { recursive: true });
  await writeFileAtomic(OUT, json);
  console.log(
    `site graph: ${stats.projects} projects（个人 ${stats.personalProjects} / org ${stats.orgProjects}）× ${stats.techs} techs × ${stats.stars} stars, ${stats.edges} edges, ${(json.length / 1024).toFixed(0)} KB -> ${OUT}`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
