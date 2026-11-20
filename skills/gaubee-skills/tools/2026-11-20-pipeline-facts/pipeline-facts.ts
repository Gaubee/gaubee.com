#!/usr/bin/env bun
/**
 * pipeline-facts — 写日报时要用到的管道数字，一次打全
 *
 * 背景（2026-11-20）：写日报的「管道」段要填补丁卷名、文件数、字节数、gen 代号、
 * 远端卷数、译文累计、图谱边数。这些数字散在 06:00 的日志、manifest 文件、
 * 翻译库与 tech-graph 里，每次都要 grep 四五次，还容易抄错
 * （2026-11-19 就把文件数抄成另一个卷的）。
 *
 * 本工具把它们一次读出来，按日报的行文顺序排好，直接照抄即可。
 *
 * 用法：
 *   bun tools/2026-11-20-pipeline-facts/pipeline-facts.ts
 *   bun tools/2026-11-20-pipeline-facts/pipeline-facts.ts --date 2026-11-19
 * 退出码：0 = 已输出；2 = 数据缺失。只读。
 */
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = process.env.GAUBEE_SKILLS_DATA ?? path.join(os.homedir(), ".gaubee-skills", "data");
const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..", "..");
const SKILL = path.join(SITE, "skills", "gaubee-skills");
const CDN = path.join(SITE, "cdn-media");
const AUTOMATION = path.join(DATA, "..", "automation");

const ymd = (d: Date): string => d.toLocaleDateString("sv-SE");
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

const argv = process.argv.slice(2);
const di = argv.indexOf("--date");
const REPORT_DAY = di >= 0 ? argv[di + 1]! : ymd(addDays(new Date(), -1));
const PACK_DAY = ymd(addDays(new Date(`${REPORT_DAY}T12:00:00`), 1));

function main(): number {
  console.log(`pipeline-facts：报告日 ${REPORT_DAY}（打包日 ${PACK_DAY}）\n`);

  // 1) 补丁卷：一次打包可能产出多个卷（2026-11-21 实证：2 个卷 / 293 新对象 / 265MB）。
  //    日志里的汇总行给个数与总量，卷名从 manifest 末尾按同样个数取——两边必须配对，
  //    否则会把昨天的单卷数字和今天的卷名拼在一起（首版就这么错了）。
  const pointerPath = path.join(CDN, "manifest", "current.json");
  const pointer = existsSync(pointerPath)
    ? (JSON.parse(readFileSync(pointerPath, "utf8")) as { gen?: number; volumes?: unknown[] })
    : null;
  let volumeCount = 0;
  let newFiles = "?";
  let bytes = "?";
  const logFile = path.join(AUTOMATION, "launchd-fetch.log");
  if (existsSync(logFile)) {
    const packs = [...readFileSync(logFile, "utf8").matchAll(/补丁卷 (\d+) 个 \/ (\d+) 字节 \/ (\d+) 新对象/g)];
    const last = packs.at(-1);
    if (last) {
      volumeCount = Number(last[1]);
      bytes = last[2]!;
      newFiles = last[3]!;
    }
  }
  const manifestFile = pointer?.gen ? path.join(CDN, "manifest", `manifest-${pointer.gen}.json`) : "";
  let patchNames: string[] = [];
  if (manifestFile && existsSync(manifestFile)) {
    const m = JSON.parse(readFileSync(manifestFile, "utf8")) as {
      volumes?: Array<{ name?: string }>;
    };
    const patches = (m.volumes ?? []).map((v) => v.name ?? "").filter((n) => n.startsWith("patch-"));
    patchNames = volumeCount > 0 ? patches.slice(-volumeCount) : patches.slice(-1);
  }
  const mb = bytes !== "?" ? (Number(bytes) / 1048576).toFixed(2) : "?";
  console.log(
    `补丁卷：${patchNames.join(" + ") || "?"}，${volumeCount || 1} 个卷，${newFiles} 个新对象，${mb}MB`,
  );

  // 2) 指针与卷数
  console.log(`媒体 gen：${pointer?.gen ?? "?"}（${pointer?.volumes?.length ?? "?"} 卷）`);

  // 3) manifest 对象数
  const manifestPath = pointer?.gen ? path.join(CDN, "manifest", `manifest-${pointer.gen}.json`) : "";
  if (manifestPath && existsSync(manifestPath)) {
    const m = JSON.parse(readFileSync(manifestPath, "utf8")) as { object_count?: number };
    console.log(`对象总数：${m.object_count ?? "?"}`);
  }

  // 4) 译文累计
  const transFile = path.join(SKILL, "translations", "x-tweets.zh.json");
  if (existsSync(transFile)) {
    const t = JSON.parse(readFileSync(transFile, "utf8")) as Record<string, string>;
    console.log(`译文累计：${Object.keys(t).length}`);
  }

  // 5) 图谱与站点视图
  const graphFile = path.join(DATA, "tech-graph.json");
  if (existsSync(graphFile)) {
    const g = JSON.parse(readFileSync(graphFile, "utf8")) as {
      stats?: { projects?: number; techs?: number; stars?: number; edges?: number };
    };
    const s = g.stats ?? {};
    console.log(`技能 Graph：${s.projects} 项目 × ${s.techs} 技术 × ${s.stars} 星标，${s.edges} 条边`);
  }
  const siteFile = path.join(SITE, "static", "skill-graph", "data.json");
  if (existsSync(siteFile)) {
    const d = JSON.parse(readFileSync(siteFile, "utf8")) as {
      stats?: { projects?: number; techs?: number; stars?: number; edges?: number };
    };
    const s = d.stats ?? {};
    console.log(`站点公开视图：${s.projects} 项目 × ${s.techs} 技术 × ${s.stars} 星标，${s.edges} 条边`);
  }

  // 6) X 抓取条数（抓取日的 changes）
  const xChanges = path.join(DATA, "sources", "x-likes", "changes", `${PACK_DAY}.json`);
  if (existsSync(xChanges)) {
    const j = JSON.parse(readFileSync(xChanges, "utf8")) as {
      added?: Array<{ language?: string }>;
    };
    const added = j.added ?? [];
    const kinds = new Map<string, number>();
    for (const a of added) {
      const k = a.language ?? "?";
      kinds.set(k, (kinds.get(k) ?? 0) + 1);
    }
    const parts = [...kinds.entries()].map(([k, n]) => `${n} ${k === "liked" ? "赞" : k === "posted" ? "帖" : k}`);
    console.log(`X 抓取：${added.length} 条（${parts.join(" / ") || "无"}）`);
  }

  // 7) staging 水位
  const stagingDir = path.join(CDN, "staging", "x");
  if (existsSync(stagingDir)) {
    let n = 0;
    let total = 0;
    for (const month of require("node:fs").readdirSync(stagingDir, { withFileTypes: true })) {
      if (!month.isDirectory()) continue;
      const dir = path.join(stagingDir, month.name);
      for (const f of require("node:fs").readdirSync(dir, { withFileTypes: true })) {
        if (!f.isFile()) continue;
        n++;
        total += require("node:fs").statSync(path.join(dir, f.name)).size;
      }
    }
    console.log(`staging：${n} 个文件 ${(total / 1048576).toFixed(1)}MB`);
  }

  console.log("\n提示：数字以本输出为准，直接照抄进日报；不确定的项先跑 report-facts-check 复核。");
  return 0;
}

process.exit(main());
