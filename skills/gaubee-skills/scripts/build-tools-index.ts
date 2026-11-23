#!/usr/bin/env bun
/**
 * build-tools-index.ts — 生成站点公开的工具索引（static/tools/index.json）
 *
 * 来源：`tools/REGISTRY.md`（含 form 列）+ `tools/FORM-INVENTORY.md`（形态与理由）
 * 输出只含公开字段：id / name / summary / form / version / updatedAt / dataNeeds / repo。
 *
 * 隐私红线：不写私有仓名、不写本机绝对路径、不写 token。internal 工具**不入索引**
 * （它们不是 kzf 的产品）。
 *
 * 用法：bun scripts/build-tools-index.ts
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..");
const SKILL = path.join(SITE, "skills", "gaubee-skills");
const TOOLS = path.join(SKILL, "tools");
const OUT_DIR = path.join(SITE, "static", "tools");
const OUT = path.join(OUT_DIR, "index.json");

interface Entry {
  id: string;
  name: string;
  summary: string;
  form: "webapp" | "self-hosted";
  version: string;
  updatedAt: string;
  dataNeeds: string[];
  repo?: string;
  /** webapp 的数据文件（相对站点静态根），由该工具自己声明 */
  dataFile?: string;
}

/** 每个 webapp 工具声明的数据依赖与数据文件（人工维护的小表） */
const WEBAPP_META: Record<string, { dataNeeds: string[]; dataFile?: string }> = {
  "stars-search": { dataNeeds: ["stars"], dataFile: "/static/tools/data/stars.json" },
  "star-timeline": { dataNeeds: ["stars"], dataFile: "/static/tools/data/stars.json" },
  "star-at": { dataNeeds: ["stars"], dataFile: "/static/tools/data/stars.json" },
  "star-readme": { dataNeeds: ["stars"] },
  "stale-check": { dataNeeds: ["stars"], dataFile: "/static/tools/data/stars.json" },
  "star-flow-weekly": { dataNeeds: ["stars"], dataFile: "/static/tools/data/stars.json" },
  "stars-drift": { dataNeeds: ["stars"], dataFile: "/static/tools/data/stars.json" },
  "x-search": { dataNeeds: ["x"], dataFile: "/static/tools/data/x.json" },
  "x-top-authors": { dataNeeds: ["x"], dataFile: "/static/tools/data/x.json" },
  "deps-why": { dataNeeds: ["deps"], dataFile: "/static/tools/data/deps.json" },
  "deps-digest": { dataNeeds: ["deps"], dataFile: "/static/tools/data/deps.json" },
  "llm-mem-fit": { dataNeeds: ["none"] },
};

function parseRegistry(): Array<{ name: string; summary: string; form: string; date: string }> {
  const out: Array<{ name: string; summary: string; form: string; date: string }> = [];
  const file = path.join(TOOLS, "REGISTRY.md");
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.startsWith("| 2")) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 8) continue;
    const date = cells[1] ?? "";
    const name = cells[2] ?? "";
    const summary = cells[4] ?? "";
    const form = cells[6] ?? "";
    if (name && ["webapp", "self-hosted"].includes(form)) out.push({ name, summary, form, date });
  }
  return out;
}

function main(): number {
  const rows = parseRegistry();
  const entries: Entry[] = [];
  for (const r of rows) {
    const meta = WEBAPP_META[r.name];
    const entry: Entry = {
      id: r.name,
      name: r.name,
      summary: r.summary.replace(/…/g, "").trim(),
      form: r.form as Entry["form"],
      version: "0.1",
      updatedAt: r.date,
      dataNeeds: meta?.dataNeeds ?? [],
      ...(meta?.dataFile ? { dataFile: meta.dataFile } : {}),
      ...(r.form === "self-hosted" ? { repo: `gaubee-tool-${r.name}` } : {}),
    };
    entries.push(entry);
  }
  entries.sort((a, b) => (a.form === b.form ? a.id.localeCompare(b.id) : a.form === "webapp" ? -1 : 1));

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    OUT,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), count: entries.length, tools: entries }, null, 2)}\n`,
    "utf8",
  );
  console.log(`written ${OUT}（${entries.length} 个工具：webapp ${entries.filter((e) => e.form === "webapp").length} / self-hosted ${entries.filter((e) => e.form === "self-hosted").length}）`);

  // 隐私自检：输出里不得出现私有路径或凭据
  const text = readFileSync(OUT, "utf8");
  // 精确匹配「像密钥的东西」，不匹配普通词：
  // 工具名 token-swap-apply 里就有 token，按子串查会误报（2026-11-23 首跑实证）。
  const badPatterns: Array<[string, RegExp]> = [
    ["本机绝对路径", /\/Users\/[a-z]/i],
    ["私有数据根", /~\.gaubee-skills|GAUBEE_SKILLS_DATA/],
    ["疑似密钥", /(github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]{20,})/],
    ["私有仓标记", /"private"\s*:\s*true/],
  ];
  for (const [label, re] of badPatterns) {
    if (re.test(text)) {
      console.error(`PRIVACY FAIL：索引里出现${label}`);
      return 1;
    }
  }
  return 0;
}

process.exit(main());
