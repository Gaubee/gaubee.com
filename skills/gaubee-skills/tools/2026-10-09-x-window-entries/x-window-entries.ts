#!/usr/bin/env bun
/**
 * x-window-entries — X 日报窗口条目选择器
 *
 * 背景：X 日报（T-1 语义）要取「昨天（本地时区）」的动态，而 x.json 的 created_at
 * 是 UTC ISO 串；此前每天由 agent 手写 python 过滤，还要逐条核对媒体是否已在
 * manifest 卷内。本工具一条命令给出可写进日报的条目清单。
 *
 * 做什么：
 *   1. 计算 <date>（默认昨天）的本地日窗 [00:00, 24:00) 对应 UTC 区间；
 *   2. 过滤 x.json 条目，按时间排序；
 *   3. 每条输出 id/kind/author/时间/正文首行/推文链接/媒体引用（站内路径），
 *      并对媒体逐个查 cdn-media manifest（current → manifest-<gen>），标注在卷/缺卷；
 *   4. --json 输出机器可读结果。
 *
 * 用法：
 *   bun x-window-entries.ts               # 昨天的窗口
 *   bun x-window-entries.ts --date 2026-10-08
 *   bun x-window-entries.ts --json
 *
 * 零第三方依赖。时区取本机时区偏移（脚本运行环境=日报口径环境）。
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface Entry {
  id: string;
  text?: string;
  created_at?: string;
  kind?: string;
  author?: string;
  mediaLocal?: string[];
  videoLocal?: string[];
}

const args = process.argv.slice(2);
const argOf = (f: string): string | undefined => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};
const date = argOf("--date") ?? new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error("用法: bun x-window-entries.ts [--date YYYY-MM-DD] [--attribution auto|tweet|fetch] [--run-date YYYY-MM-DD] [--json]");
  process.exit(2);
}
// 归窗规则（kzf 2026-10-09 裁决，方案 a）：liked/bookmarked 按「抓取差分」归窗——
// 日报运行日 run-date（默认今天）的 x-likes changes added 即「上次抓取以来的赞」，东八区
// 8:30 日更节奏下恰是昨天点的赞；X 不暴露点赞时刻，created_at 是推文发布时间（雪花
// 可证），对 liked 只能算代位。posted/reposted 的行为时间=推文发布时间，维持按窗。
// auto = 两类各用各的口径合并输出；tweet/fetch = 单一口径（诊断用）。
const attribution = argOf("--attribution") ?? "auto";
if (!["auto", "tweet", "fetch"].includes(attribution)) {
  console.error("--attribution 只接受 auto | tweet | fetch");
  process.exit(2);
}
const jsonMode = args.includes("--json");

// 本地日窗 → UTC ISO 前缀比较（created_at 形如 2026-10-07T19:07:41.000Z）
const lo = new Date(`${date}T00:00:00`);
const hi = new Date(lo.getTime() + 86_400_000);
const loIso = lo.toISOString();
const hiIso = hi.toISOString();

const xPath = process.env.X_JSON ?? join(homedir(), ".gaubee-skills/data/sources/x-likes/x.json");
const data = JSON.parse(readFileSync(xPath, "utf8")) as { items: Record<string, Entry> };

const wantTweet = attribution !== "fetch";
const wantFetch = attribution !== "tweet";
const byTweet = wantTweet
  ? Object.values(data.items)
      .filter((e) => ["posted", "reposted"].includes(e.kind ?? "") && (e.created_at ?? "") >= loIso && (e.created_at ?? "") < hiIso)
      .map((e) => ({ entry: e, via: "tweet-window" as const }))
  : [];

let viaFetch: { entry: Entry; via: "fetch-diff" }[] = [];
if (wantFetch) {
  const runDate = argOf("--run-date") ?? new Date().toISOString().slice(0, 10);
  const changesPath =
    process.env.X_CHANGES_DIR ?? join(homedir(), ".gaubee-skills/data/sources/x-likes/changes");
  const changesFile = join(changesPath, `${runDate}.json`);
  let addedUrls: string[] = [];
  try {
    const changes = JSON.parse(readFileSync(changesFile, "utf8")) as {
      added?: { html_url?: string }[];
    };
    addedUrls = (changes.added ?? [])
      .map((a) => a.html_url ?? "")
      .filter((u) => u.includes("/status/"));
  } catch (err) {
    console.error(`抓取差分不可用（${changesFile}）：${String(err)}`);
    process.exit(1);
  }
  viaFetch = addedUrls
    .map((u) => data.items[u.split("/status/")[1]!.split("?")[0]!])
    .filter((e): e is Entry => Boolean(e))
    .map((e) => ({ entry: e, via: "fetch-diff" as const }));
}

const inWindow = [...byTweet, ...viaFetch]
  .filter((row, i, all) => all.findIndex((r) => r.entry.id === row.entry.id) === i)
  .sort((a, b) => (a.entry.created_at ?? "").localeCompare(b.entry.created_at ?? ""));

// manifest 对账：current.json → manifest-<gen>.json 的对象键集合
const mediaRoot = join(homedir(), "Dev/Github/gaubee.com/cdn-media");
let manifestKeys = new Set<string>();
try {
  const cur = JSON.parse(readFileSync(join(mediaRoot, "manifest/current.json"), "utf8")) as {
    gen: number;
    manifest_path?: string;
  };
  const mPath = cur.manifest_path
    ? join(mediaRoot, cur.manifest_path)
    : join(mediaRoot, `manifest/manifest-${cur.gen}.json`);
  const m = JSON.parse(readFileSync(mPath, "utf8")) as { objects: unknown };
  const objs = m.objects;
  const keys: string[] = Array.isArray(objs)
    ? objs.map((o) => (typeof o === "string" ? o : (o as { key: string }).key))
    : Object.keys(objs as Record<string, unknown>);
  manifestKeys = new Set(keys);
} catch (err) {
  if (!jsonMode) console.error(`manifest 对账不可用：${String(err)}`);
}

interface Out {
  id: string;
  kind: string;
  author: string;
  createdAt: string;
  url: string;
  textHead: string;
  via: string;
  media: { local: string; inManifest: boolean }[];
}
const outs: Out[] = inWindow.map(({ entry: e, via }) => {
  const author = e.author ?? "?";
  const locals = [...(e.mediaLocal ?? []), ...(e.videoLocal ?? [])];
  return {
    id: e.id,
    kind: e.kind ?? "?",
    author,
    createdAt: e.created_at ?? "",
    url: `https://x.com/${author}/status/${e.id}`,
    textHead: (e.text ?? "").replace(/\s+/g, " ").slice(0, 120),
    via,
    media: locals.map((l) => ({ local: l, inManifest: manifestKeys.has(l) ?? manifestKeys.has(l.replace(/^cdn-media\//, "")) })),
  };
});

if (jsonMode) {
  console.log(JSON.stringify({ date, attribution, window: { utcFrom: loIso, utcTo: hiIso }, count: outs.length, entries: outs }, null, 2));
  process.exit(0);
}

console.log(`x-window-entries：${date}（归窗 ${attribution}；tweet 窗口 UTC ${loIso.slice(0, 16)} ~ ${hiIso.slice(0, 16)}）`);
console.log(`条目 ${outs.length} 条\n`);
for (const o of outs) {
  console.log(`[${o.kind}] ${o.createdAt.slice(11, 16)} local @${o.author}（${o.via}）  ${o.url}`);
  console.log(`  ${o.textHead}`);
  for (const m of o.media) {
    console.log(`  media: /${m.local}  ${m.inManifest ? "在卷 ✓" : "缺卷 ✗（先 media-pack --patch）"}`);
  }
  console.log("");
}
