#!/usr/bin/env bun
/**
 * avatar-healthcheck.ts — 作者头像 URL 健康抽查（工具工坊 2026-10-11）
 *
 * 解决什么：X 用户换头像后旧 pbs.twimg.com URL 会失效，渲染出的 <img> 裂图
 * （实证 2026-10-11：@irsyad 换头像，01707 归档的旧 URL 已 404）。本工具抽样
 * HEAD authors.json 的头像 URL，报告失效数并给出重富化指引（backfill --ids 已
 * 支持 --ids 强制重拉，upsert 会以新值更新）。
 *
 * 怎么跑：bun tools/2026-10-11-avatar-healthcheck/avatar-healthcheck.ts [--sample N] [--fail-on-dead]
 *   --sample N：抽样数（默认 60；0 = 全量。全量对 pbs.twimg.com 是数千请求，慎用）
 *   --fail-on-dead：检出失效即退出 1（供 cron 门禁）
 * 退出码：0 = 抽样全部存活（或未启用 fail-on-dead）；1 = 启用门禁且检出失效。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const sampleIdx = argv.indexOf("--sample");
const sample = sampleIdx > -1 ? Number.parseInt(argv[sampleIdx + 1] ?? "60", 10) : 60;
const failOnDead = argv.includes("--fail-on-dead");

const DATA = process.env.GAUBEE_SKILLS_DATA ?? path.join(process.env.HOME!, ".gaubee-skills", "data");
const AUTHORS = path.join(DATA, "sources", "x-likes", "authors.json");

const authors = JSON.parse(readFileSync(AUTHORS, "utf8")) as Record<string, { name?: string; avatar?: string }>;
const entries = Object.entries(authors).filter(([, v]) => !!v.avatar);

// 等距抽样：覆盖老作者与新作者
const step = sample > 0 ? Math.max(1, Math.floor(entries.length / sample)) : 1;
const picked: [string, string][] = [];
for (let i = 0; i < entries.length && picked.length < (sample > 0 ? sample : entries.length); i += step) {
  const [handle, v] = entries[i]!;
  if (v.avatar) picked.push([handle, v.avatar]);
}

let dead = 0;
const deadHandles: string[] = [];
const results = await Promise.all(
  picked.map(async ([handle, url]) => {
    try {
      const r = await fetch(url, { method: "HEAD", redirect: "follow" });
      return { handle, ok: r.ok };
    } catch {
      return { handle, ok: false };
    }
  }),
);
for (const r of results) {
  if (!r.ok) {
    dead++;
    deadHandles.push(r.handle);
  }
}

console.log(`authors.json ${Object.keys(authors).length} 位作者 · 抽样 HEAD ${picked.length} 个头像 URL`);
console.log(`失效：${dead}${dead.length ? `（${deadHandles.slice(0, 8).join(", ")}${deadHandles.length > 8 ? " …" : ""}）` : ""}`);
if (dead > 0) {
  console.log("下一步：bun scripts/x-media-backfill.ts --ids <这些作者的相关推文 id>（强制重富化，头像 upsert 以新值覆盖）");
  console.log("或重跑全量纠正模式刷新全部头像：bun scripts/x-media-backfill.ts --all");
}
process.exit(failOnDead && dead > 0 ? 1 : 0);
