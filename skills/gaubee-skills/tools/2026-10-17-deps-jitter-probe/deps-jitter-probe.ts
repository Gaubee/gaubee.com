// deps-jitter-probe.ts — deps changes 日噪根因解剖（工坊 2026-10-17 提案 2）
//
// 动机：jitter-report 实证三仓连续 8 天被 changes 点名、零快照级变化。根因待定：
//  A. 仓库 package.json 真的每天在变（CI 格式化/非依赖字段改动）→ 仓库侧行为；
//  B. fetcher 的 changed 判定把「重新抓取」误记为「变更」→ 工具侧 bug。
// 本工具对点名仓库取 GitHub API 的 package.json（主分支）blob sha 与内容解析出的
// 依赖表，与「今天快照」对比：blob sha 相同 → 内容没变（B 成立）；blob sha 变了但
// 依赖表没变 → A 成立且抖动来自非依赖字段。只读，产判定收据。
//
// 用法: bun tools/2026-10-17-deps-jitter-probe/deps-jitter-probe.ts [--repos a,b,c]
// 缺省取 jitter 高频三仓。经 gh api 认证调用（本机 gh 已登录）。退出码：0 正常。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const DATA = new URL("../../../../../../../.gaubee-skills/data", import.meta.url).pathname;

function ghapi(path: string): { code: number; body: string; sha?: string } {
  const r = spawnSync("gh", ["api", path, "--header", "Accept: application/vnd.github.raw"], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  return { code: r.status ?? 1, body: r.stdout ?? "" };
}

function depsOf(content: string): string[] {
  const j = JSON.parse(content) as Record<string, Record<string, string>>;
  const out: string[] = [];
  for (const section of ["dependencies", "devDependencies", "peerDependencies"]) {
    for (const [k, v] of Object.entries(j[section] ?? {})) out.push(`${section}:${k}@${v}`);
  }
  return out.sort();
}

const DEFAULT = "BioforestChain/PlusMeta-Admin,BioforestChain/net-mesh-simulator,Gaubee/jSouper";
const argI = process.argv.indexOf("--repos");
const repos = (argI > 0 ? process.argv[argI + 1]! : DEFAULT).split(",");

// 今天快照（deps-fetch 的最新 history）
const histDir = join(DATA, "sources/github-deps/history");
const latest = readdirSorted(histDir).at(-1);
if (!latest) {
  console.error("deps-jitter-probe：history 快照为空");
  process.exit(1);
}
console.log(`对照快照：history/${latest}`);
const snap = JSON.parse(readFileSync(join(histDir, latest), "utf8")) as {
  repos: { repo: string; deps: { name: string; version: string; section: string }[] }[];
};

for (const repo of repos) {
  const local = snap.repos.find((r) => r.repo === repo);
  const localKeys = (local?.deps ?? []).map((d) => `${d.section}:${d.name}@${d.version}`).sort();
  const remote = ghapi(`repos/${repo}/contents/package.json?ref=HEAD`);
  if (remote.code !== 0) {
    console.log(`\n${repo}\n  FAIL GitHub API 不可达（exit ${remote.code}）`);
    continue;
  }
  const remoteKeys = depsOf(remote.body);
  const sameDeps = JSON.stringify(localKeys) === JSON.stringify(remoteKeys);
  console.log(`\n${repo}`);
  console.log(`  快照依赖 ${localKeys.length} 项 / 远端 package.json 依赖 ${remoteKeys.length} 项 / 内容一致=${sameDeps}`);
  if (!sameDeps) {
    const onlyLocal = localKeys.filter((k) => !remoteKeys.includes(k));
    const onlyRemote = remoteKeys.filter((k) => !localKeys.includes(k));
    console.log(`  仅快照有：${onlyLocal.slice(0, 3).join(", ") || "无"}`);
    console.log(`  仅远端有：${onlyRemote.slice(0, 3).join(", ") || "无"}`);
  }
}
console.log("\n判定：内容一致=true → fetcher 侧把重抓记成了变更（B）；=false → 仓库 package.json 确有非依赖级每日改动（A）。");

function readdirSorted(dir: string): string[] {
  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  return readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
}
