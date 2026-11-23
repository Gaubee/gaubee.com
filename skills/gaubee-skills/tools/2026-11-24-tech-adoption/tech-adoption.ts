#!/usr/bin/env bun
/**
 * tech-adoption — 我什么时候开始用 X、它出现在哪些项目里（webapp）
 *
 * 背景（2026-11-24）：kzf 常问「我什么时候开始用 Y 技术的」。答案在 tech-graph 里：
 * nodes 的 tech 带 usedBy，timeline 记首见日期。本工具把这两份投影在浏览器里对上，
 * 支持正查（技术 → 首见日 + 项目）与反查（项目 → 技术栈）。
 *
 * 形态：webapp（只读站点公开投影 skill-graph/data.json，纯前端算）。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..", "..");
const GRAPH = process.env.GAUBEE_GRAPH ?? path.join(SITE, "static", "skill-graph", "data.json");

interface Node {
  id: string;
  kind: string;
  label: string;
  meta?: { usedBy?: number; url?: string; depsCount?: number };
}
interface Graph {
  generated_at?: string;
  stats?: { projects?: number; techs?: number; stars?: number; edges?: number };
  nodes: Node[];
  edges: Array<{ from?: string; to?: string; source?: string; target?: string }>;
  timeline: Array<[string, string]>;
  timelineMeta?: { baselineDate: string; baselineCount: number };
}

function main(): number {
  const argv = process.argv.slice(2);
  const query = argv.find((a) => !a.startsWith("--")) ?? "";
  if (!existsSync(GRAPH)) {
    console.error(`缺少 ${GRAPH}（先跑 bun scripts/sync-site-graph.ts）`);
    return 2;
  }
  const g = JSON.parse(readFileSync(GRAPH, "utf8")) as Graph;
  const firstSeen = new Map(g.timeline.map(([tech, date]) => [tech, date]));
  const techs = g.nodes.filter((n) => n.kind === "tech");
  const projects = g.nodes.filter((n) => n.kind === "project");

  // 边：tech ← project（uses）
  const edgePairs: Array<{ from: string; to: string }> = g.edges.map((e) => ({
    from: e.from ?? e.source ?? "",
    to: e.to ?? e.target ?? "",
  }));

  if (!query) {
    console.log(`技术采用索引：${projects.length} 个项目 × ${techs.length} 个技术`);
    const meta = g.timelineMeta;
    if (meta) {
      console.log(
        `时间线基线 ${meta.baselineDate}（当时已有 ${meta.baselineCount} 项，这些不标「新采用」）；` +
          `此后首见 ${g.timeline.length} 项`,
      );
    }
    const recent = [...g.timeline].sort((a, b) => b[1].localeCompare(a[1])).slice(0, 12);
    console.log("\n最近首见的技术：");
    for (const [tech, date] of recent) {
      const n = techs.find((t) => t.label === tech);
      console.log(`  ${date}  ${tech}${n?.meta?.usedBy ? `（${n.meta.usedBy} 个项目）` : ""}`);
    }
    console.log("\n提示：`tech-adoption <技术名>` 查首见日与项目；`tech-adoption <仓库名>` 反查技术栈。");
    return 0;
  }

  const q = query.toLowerCase();

  // 正查：技术 → 首见 + 用在哪些项目
  const techHit = techs.filter((t) => t.label.toLowerCase().includes(q));
  if (techHit.length) {
    console.log(`技术匹配 ${techHit.length} 个：\n`);
    for (const t of techHit.slice(0, 10)) {
      const date = firstSeen.get(t.label) ?? "（基线前已在用）";
      const users = edgePairs
        .filter((e) => e.from.startsWith("project:") && e.to === t.id)
        .map((e) => e.from.replace("project:", ""));
      console.log(`【${t.label}】首见 ${date}`);
      if (users.length) console.log(`  用于：${users.join("、")}`);
      else if (t.meta?.usedBy) console.log(`  用于 ${t.meta.usedBy} 个项目（边未投影）`);
    }
    return 0;
  }

  // 反查：项目 → 技术栈
  const projHit = projects.filter((p) => p.label.toLowerCase().includes(q));
  if (projHit.length) {
    console.log(`项目匹配 ${projHit.length} 个：\n`);
    for (const p of projHit.slice(0, 5)) {
      const stack = edgePairs
        .filter((e) => e.from === p.id && e.to.startsWith("tech:"))
        .map((e) => e.to.replace("tech:", ""));
      console.log(`【${p.label}】${p.meta?.depsCount ? `${p.meta.depsCount} 个依赖` : ""}`);
      if (stack.length) console.log(`  ${stack.slice(0, 20).join("、")}${stack.length > 20 ? ` …另 ${stack.length - 20}` : ""}`);
    }
    return 0;
  }

  // 常见误判：私有仓不在公开投影里（隐私断言会剔除），所以查不到不等于不存在
  console.log(`没有匹配「${query}」的技术或项目`);
  console.log("说明：公开投影只含公开仓（私有仓被隐私断言剔除）。查私有仓请用本地 tech-graph.md。");
  return 0;
}

process.exit(main());
