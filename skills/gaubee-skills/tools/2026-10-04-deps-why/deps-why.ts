#!/usr/bin/env bun
/**
 * deps-why.ts — “我在哪里用的 X？”依赖溯源（gaubee-skills 工具工坊提案，2026-10-04）
 *
 * 文件意图（正交意图清单）：
 * - [2026-10-04] 原始需求（kzf 数据模型裁决的延伸）：order/time=0 落地后，需要一个快速回答“某技术我在哪些项目用、什么版本、什么时候开始用”的工具。
 * - 1. 读 data/sources/github-deps/deps.json 找出使用某依赖的全部项目（含版本与 dependencies/devDependencies 分区）
 * - 2. 读 deps history 给出首次出现日期（跟踪期内的真实采用时间；基线存量如实标注“跟踪前已有”）
 *
 * 用法：bun scripts/deps-why.ts <包名，如 vite / @gaubee/nodekit>
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { sourceDir } from "../../scripts/lib.ts";

const DEPS_DIR = sourceDir("github-deps");

async function main() {
  const pkg = process.argv[2];
  if (!pkg) {
    console.error(
      "用法：bun scripts/deps-why.ts <包名>   例：bun scripts/deps-why.ts @gaubee/nodekit",
    );
    process.exit(2);
  }

  const deps: {
    repos: {
      repo: string;
      url: string;
      private: boolean;
      deps: { name: string; version: string; section: string }[];
    }[];
  } = JSON.parse(await Bun.file(path.join(DEPS_DIR, "deps.json")).text());

  // 首见日期：基线（最老快照）判定必须先于跟踪期扫描——基线里已存在的依赖是"存量"，
  // 不是"跟踪期内首见"（2026-10-04 修正：此前顺序反了，存量会被误标为最新快照日首见）
  const histDir = path.join(DEPS_DIR, "history");
  let firstSeen = "";
  let baseline = false;
  if (existsSync(histDir)) {
    const files = readdirSync(histDir)
      .filter((f) => f.endsWith(".json"))
      .sort();
    if (files.length > 0) {
      const base = JSON.parse(await Bun.file(path.join(histDir, files[0])).text()) as {
        repos: { deps: { name: string }[] }[];
      };
      baseline = base.repos.some((r) => r.deps.some((d) => d.name === pkg));
      if (!baseline) {
        for (const f of files.slice(1)) {
          const snap = JSON.parse(await Bun.file(path.join(histDir, f)).text()) as {
            repos: { deps: { name: string }[] }[];
          };
          if (snap.repos.some((r) => r.deps.some((d) => d.name === pkg))) {
            firstSeen = f.replace(".json", "");
            break;
          }
        }
      }
    }
  }

  const hits = deps.repos.filter((r) => r.deps.some((d) => d.name === pkg));
  console.log(`# ${pkg} — ${hits.length} 个项目在使用`);
  if (baseline) console.log(`首次出现：早于依赖跟踪开始（${files0(histDir)} 基线存量）`);
  else if (firstSeen) console.log(`首次出现（跟踪期内）：${firstSeen}`);
  console.log("");
  for (const r of hits) {
    const ds = r.deps.filter((d) => d.name === pkg).map((d) => `${d.version} (${d.section})`);
    console.log(`- ${r.repo}${r.private ? " 🔒" : ""} — ${ds.join(", ")}  ${r.url}`);
  }
  if (hits.length === 0) {
    console.log(`（当前依赖快照中没有项目使用 ${pkg}）`);
  }
}

function files0(dir: string): string {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();
  return files[0] ? files[0].replace(".json", "") : "?";
}

main();
