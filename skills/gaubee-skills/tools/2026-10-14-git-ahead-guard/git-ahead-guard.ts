// git-ahead-guard.ts — 发布预检的「本地超前」守卫（工坊 2026-10-14 提案 1）
//
// 动机（2026-10-13 实证）：cron 产物提交 aaa55d49f 忘了 push，publish.ts 的预检
// 只查「落后远端」不查「本地超前」——结果产物搭着下一次发布的提交才上去，期间
// 单独触发的 CI 构建不含这些内容。本工具在发布流程前给出明确的超前信号。
//
// 做什么：对站点仓与 cdn-media 子仓各跑 `git rev-list --count origin/main..main`
// （用本地最近一次 fetch 到的 origin 引用，离线可判；新提交一定会计入），
// ahead > 0 即 FAIL 并列出待推提交。只读，不 fetch 不 push（--fetch 可选刷新引用）。
//
// 用法: bun tools/2026-10-14-git-ahead-guard/git-ahead-guard.ts [--fetch]
// 退出码：0 = 两侧仓无本地超前；1 = 有未推提交；2 = 用法/仓库异常。
import { spawnSync } from "node:child_process";

const REPO_ROOT = new URL("../../../..", import.meta.url).pathname;
const REPOS = [
  { name: "gaubee.com", path: REPO_ROOT },
  { name: "cdn-media", path: `${REPO_ROOT}cdn-media/` },
];

const doFetch = process.argv.includes("--fetch");
if (process.argv.filter((a) => !a.startsWith("--")).length > 2) {
  console.error("用法: bun tools/2026-10-14-git-ahead-guard/git-ahead-guard.ts [--fetch]");
  process.exit(2);
}

function git(args: string[], cwd: string): { out: string; code: number } {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { out: (r.stdout ?? "").trim(), code: r.status ?? 1 };
}

let failed = 0;
for (const repo of REPOS) {
  if (doFetch) git(["fetch", "origin"], repo.path);
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], repo.path).out;
  const ahead = git(["rev-list", "--count", `origin/${branch}..${branch}`], repo.path);
  const behind = git(["rev-list", "--count", `${branch}..origin/${branch}`], repo.path);
  if (ahead.code !== 0 || behind.code !== 0) {
    failed++;
    console.log(`FAIL ${repo.name}：origin/${branch} 引用不可用（是否从未 fetch？）`);
    continue;
  }
  if (Number(ahead.out) > 0) {
    failed++;
    const list = git(["log", "--oneline", `origin/${branch}..${branch}`], repo.path).out;
    console.log(`FAIL ${repo.name}：本地领先 origin/${branch} ${ahead.out} 个提交：\n${list}`);
  } else {
    console.log(`PASS ${repo.name}（ahead 0 / behind ${behind.out}）`);
  }
}
console.log(failed === 0 ? "GUARD OK：无本地超前，可安全发布" : "GUARD FAIL：先 git push 再发布");
process.exit(failed === 0 ? 0 : 1);
