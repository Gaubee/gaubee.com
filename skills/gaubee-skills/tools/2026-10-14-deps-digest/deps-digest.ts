// deps-digest.ts — 依赖变更人话化（工坊 2026-10-14 提案 2）
//
// 动机：github-deps 的 changes 只给「N 个仓库依赖变更」，日报也只能写「依赖变更 3」；
// 版本明细躺在相邻两天的 history 快照里没人读。本工具对比 [prev, date] 两份
// 快照，对 changes 里点名（bumpedCount>0）的仓库逐个产出「依赖从什么到什么」的
// 一句话明细，供日报直接引用。
//
// 口径：以 changes/<date>.json 的 changed[] 为准（与日报同源）；每仓 diff
// history/<prev>.json 与 history/<date>.json 的 deps 映射（name+section 为键），
// 列升级（版本变化）与新增（此前不存在）。未变更但 changes 点名的仓库如实标注。
//
// 用法: bun tools/2026-10-14-deps-digest/deps-digest.ts [--date YYYY-MM-DD]
//   --date 默认取 changes 目录最新一份；prev 取快照中相邻前一份。
// 退出码：0 = 正常输出；1 = 数据缺失（fail-closed）。
import { readdirSync } from "node:fs";
import { join } from "node:path";

const DATA = new URL("../../../../../../../.gaubee-skills/data", import.meta.url).pathname;
const SRC = join(DATA, "sources/github-deps");
type Dep = { name: string; version: string; section: string };
type Snapshot = { repos: { repo: string; deps: Dep[] }[] };

function dayArg(): string {
  const i = process.argv.indexOf("--date");
  const files = readdirSync(join(SRC, "changes")).filter((f) => f.endsWith(".json")).sort();
  if (i > 0 && process.argv[i + 1]) return process.argv[i + 1]!;
  return files[files.length - 1]!.replace(".json", "");
}

function loadSnapshot(day: string): Snapshot {
  return JSON.parse(await0(day)) as Snapshot;
  function await0(day: string): string {
    return require("node:fs").readFileSync(join(SRC, "history", `${day}.json`), "utf8");
  }
}

const day = dayArg();
const prev = (JSON.parse(require("node:fs").readFileSync(join(SRC, "changes", `${day}.json`), "utf8")) as { prev_date?: string }).prev_date;
if (!prev) {
  console.error(`deps-digest: changes/${day}.json 无 prev_date（基线日？），无差分可对比`);
  process.exit(1);
}
const a = loadSnapshot(prev);
const b = loadSnapshot(day);
const mapOf = (s: Snapshot) => new Map(s.repos.map((r) => [r.repo, r.deps]));
const prevRepos = mapOf(a);
const currRepos = mapOf(b);

const changes = JSON.parse(require("node:fs").readFileSync(join(SRC, "changes", `${day}.json`), "utf8")) as {
  changed: { full_name: string }[];
};
if (changes.changed.length === 0) {
  console.log(`deps-digest ${day}：changes 点名 0 仓，无依赖变更`);
  process.exit(0);
}
for (const c of changes.changed) {
  const repo = c.full_name;
  const before = new Map((prevRepos.get(repo) ?? []).map((d) => [`${d.section}:${d.name}`, d]));
  const after = new Map((currRepos.get(repo) ?? []).map((d) => [`${d.section}:${d.name}`, d]));
  const parts: string[] = [];
  for (const [key, d] of after) {
    const was = before.get(key);
    if (!was) parts.push(`新增 ${d.name}@${d.version}`);
    else if (was.version !== d.version) parts.push(`${d.name} ${was.version}→${d.version}`);
  }
  for (const [key, d] of before) {
    if (!after.has(key)) parts.push(`移除 ${d.name}`);
  }
  console.log(parts.length ? `${repo}：${parts.join("；")}` : `${repo}：快照对比无版本级变化（仅元数据/清单抖动）`);
}
