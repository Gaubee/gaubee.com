#!/usr/bin/env bun
/**
 * star-readme — 星标仓库 README 首屏速览
 *
 * 回答「这个 star 到底是干嘛的」：先用本地 catalog 模糊匹配仓库名，再经 gh api
 * 拉 README 抽取首段（跳过徽章行/HTML 注释/图片），直接可读。已登录 gh 的网络
 * 读取（公开数据），零第三方依赖。
 *
 * 用法：bun tools/2026-10-29-star-readme/star-readme.ts <关键词|owner/repo>
 * 退出码：0 = 成功；1 = 未匹配/无 README；2 = 用法错误。
 */
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

const DATA = process.env.GAUBEE_SKILLS_DATA ?? path.join(os.homedir(), ".gaubee-skills", "data");
const CATALOG = path.join(DATA, "sources", "github-stars", "catalog.md");

function catalogRepos(): string[] {
  const out: string[] = [];
  for (const line of readFileSync(CATALOG, "utf8").split("\n")) {
    const m = line.match(/^- \[([^\]]+\/[^\]]+)\]\(https:\/\/github\.com\//);
    if (m) out.push(m[1]!);
  }
  return out;
}

function pickReadmeSection(md: string): string {
  const lines = md.split("\n");
  const kept: string[] = [];
  for (const l of lines) {
    const t = l.trim();
    if (!t) continue;
    // 跳过徽章/图标行、HTML 注释、纯图片、标题行与目录
    if (t.startsWith("#")) continue;
    if (t.startsWith("<!--")) continue;
    if (/^\[!?!\[/.test(t)) continue;
    if (/^<img/i.test(t)) continue;
    if (/^[-*]\s*\[/.test(t) && t.includes("](#")) continue;
    kept.push(t);
    if (kept.length >= 4) break;
  }
  return kept.join("\n");
}

function main(): number {
  const q = process.argv[2];
  if (!q) {
    console.error("用法：star-readme.ts <关键词|owner/repo>");
    return 2;
  }
  if (!existsSync(CATALOG)) {
    console.error(`catalog 缺失：${CATALOG}`);
    return 1;
  }
  const repos = catalogRepos();
  const ql = q.toLowerCase();
  let target: string | undefined;
  if (repos.includes(q)) target = q;
  else {
    const hits = repos.filter((r) => r.toLowerCase().includes(ql));
    if (hits.length === 0) {
      console.error(`收藏里没有匹配「${q}」的仓库`);
      return 1;
    }
    if (hits.length > 1) {
      console.log(`多个匹配（取第一个，其余：${hits.slice(1, 5).join("、")}）：`);
    }
    target = hits[0]!;
  }

  const r = spawnSync(
    "gh",
    ["api", `repos/${target}/readme`, "--jq", ".content", "--hostname", "github.com"],
    { timeout: 30_000 },
  );
  if (r.status !== 0) {
    console.error(`README 拉取失败：${(r.stderr ?? "").toString().trim().slice(0, 160)}`);
    return 1;
  }
  const md = Buffer.from(r.stdout!.toString().replace(/\s+/g, ""), "base64").toString("utf8");
  console.log(`★ ${target}`);
  console.log(pickReadmeSection(md));
  return 0;
}

process.exit(main());
