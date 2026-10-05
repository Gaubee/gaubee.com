#!/usr/bin/env bun
/**
 * x-search.ts — X 动态速查（gaubee-skills 工具工坊提案，2026-10-05）
 *
 * 文件意图（正交意图清单）：
 * - [2026-10-05] 原始需求（kzf）：X 档案 3025 条刚完成正文/媒体回灌，「我记得看过/发过一条讲 X
 *   的推」没有检索手段；档案质量抽查（缺本地媒体、作者缺失）也需要快速过滤。
 * - 1. 多关键词 AND 子串检索（大小写不敏感；命中字段：正文 + 作者）
 * - 2. 过滤器：--kind posted|liked|bookmarked · --author <子串> · --media / --video / --nolocal（任一
 *    媒体侧有远程无本地，与 x-media-audit 缺口口径一致）· --since/--until YYYY-MM-DD ·
 *    -n 条数上限（默认 20）· --json 管道输出
 * - 3. 排序按数据法则（kzf 2026-10-04）：时间优先（新→旧），缺失时间置零沉底，id 兜底稳定序
 *
 * 用法：bun tools/2026-10-05-x-search/x-search.ts [关键词...] [过滤器...]
 * 退出码：命中 0 → 1（grep 惯例），供脚本判断
 */
import path from "node:path";

import { sourceDir } from "../../scripts/lib.ts";

interface Tweet {
  id: string;
  text: string;
  created_at?: string;
  kind: string;
  author?: string;
  media?: string[];
  video?: string[];
  mediaLocal?: string[];
  videoLocal?: string[];
  synChecked?: boolean;
}
interface XStore {
  items: Record<string, Tweet>;
}

const USAGE = `用法：x-search.ts [关键词...] [--kind posted|liked|bookmarked] [--author 子串]
           [--media] [--video] [--nolocal] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [-n N] [--json]`;

function usageError(msg: string): never {
  console.error(`${msg}\n${USAGE}`);
  process.exit(2);
}

/** 单行摘要：压平空白；定位首个命中词，取以它为中心的窗口 */
function snippet(text: string, keywords: string[], width = 110): string {
  const flat = text.replaceAll(/\s+/g, " ").trim();
  if (flat.length <= width) return flat;
  const lower = flat.toLowerCase();
  const anchor = keywords.length
    ? Math.max(0, lower.indexOf(keywords[0]!.toLowerCase()))
    : 0;
  const start = Math.max(0, Math.min(anchor - Math.floor(width / 3), flat.length - width));
  return `${start > 0 ? "…" : ""}${flat.slice(start, start + width)}…`;
}

async function main() {
  const argv = process.argv.slice(2);
  const keywords: string[] = [];
  let kind = "";
  let author = "";
  let wantMedia = false;
  let wantVideo = false;
  let wantNoLocal = false;
  let since = "";
  let until = "";
  let limit = 20;
  let asJson = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--kind") kind = argv[++i] ?? usageError("--kind 缺参数");
    else if (a === "--author") author = argv[++i] ?? usageError("--author 缺参数");
    else if (a === "--media") wantMedia = true;
    else if (a === "--video") wantVideo = true;
    else if (a === "--nolocal") wantNoLocal = true;
    else if (a === "--since") since = argv[++i] ?? usageError("--since 缺参数");
    else if (a === "--until") until = argv[++i] ?? usageError("--until 缺参数");
    else if (a === "-n" || a === "--limit") limit = Number.parseInt(argv[++i] ?? "", 10) || 20;
    else if (a === "--json") asJson = true;
    else if (a.startsWith("-")) usageError(`未知选项：${a}`);
    else keywords.push(a.toLowerCase());
  }

  const store: XStore = JSON.parse(
    await Bun.file(path.join(sourceDir("x-likes"), "x.json")).text(),
  );
  const items = Object.values(store.items);

  // R6 时间法则：缺失时间置零（epoch），新→旧，id 兜底
  const t = (x: Tweet) => (x.created_at ? Date.parse(x.created_at) : 0);
  const sorted = [...items].sort((a, b) => t(b) - t(a) || (a.id < b.id ? -1 : 1));

  const hits = sorted.filter((x) => {
    if (kind && x.kind !== kind) return false;
    if (author && !(x.author ?? "").toLowerCase().includes(author.toLowerCase())) return false;
    if (wantMedia && !(x.media?.length || x.video?.length)) return false;
    if (wantVideo && !x.video?.length) return false;
    // --nolocal：任一媒体侧「有远程 URL 无本地副本」（与 x-media-audit 的缺口口径一致）
    if (
      wantNoLocal &&
      !((x.media?.length && !x.mediaLocal?.length) || (x.video?.length && !x.videoLocal?.length))
    )
      return false;
    const day = x.created_at?.slice(0, 10) ?? "";
    if (since && (!day || day < since)) return false;
    if (until && (!day || day > until)) return false;
    const hay = `${x.text}\n${x.author ?? ""}`.toLowerCase();
    return keywords.every((kw) => hay.includes(kw));
  });

  if (asJson) {
    console.log(
      JSON.stringify(
        hits.slice(0, limit).map((x) => ({
          id: x.id,
          created_at: x.created_at ?? null,
          kind: x.kind,
          author: x.author ?? null,
          text: x.text,
          mediaCount: x.media?.length ?? 0,
          videoCount: x.video?.length ?? 0,
          mediaLocal: x.mediaLocal ?? [],
          videoLocal: x.videoLocal ?? [],
        })),
        null,
        1,
      ),
    );
    if (hits.length === 0) process.exit(1);
    return;
  }

  console.log(`${hits.length}/${items.length} 条命中${keywords.length ? `（关键词：${keywords.join(" + ")}）` : ""}`);
  for (const x of hits.slice(0, limit)) {
    const hasGap =
      (x.media?.length && !x.mediaLocal?.length) || (x.video?.length && !x.videoLocal?.length);
    const marks = [
      x.media?.length ? `图×${x.media.length}` : "",
      x.video?.length ? "视频" : "",
      hasGap ? "本地化缺口" : "",
    ]
      .filter(Boolean)
      .join(" · ");
    console.log(
      `[${x.created_at?.slice(0, 10) ?? "????-??-??"}] ${x.kind} · ${x.id}${x.author ? ` · @${x.author}` : ""}${marks ? ` · ${marks}` : ""}`,
    );
    if (x.text) console.log(`  ${snippet(x.text, keywords)}`);
  }
  if (hits.length > limit) console.log(`… 其余 ${hits.length - limit} 条用 -n 提高上限查看`);
  if (hits.length === 0) process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
