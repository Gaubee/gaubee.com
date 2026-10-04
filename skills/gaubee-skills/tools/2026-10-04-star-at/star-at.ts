#!/usr/bin/env bun
/**
 * star-at.ts — 收藏序号查询（gaubee-skills 工具工坊提案，2026-10-04）
 *
 * 文件意图（正交意图清单）：
 * - [2026-10-04] 原始需求（kzf）："根据 star 的顺序拟定一个 order 字段"——本工具是 order 字段的第一个消费者：
 *   正查：第 N 个收藏是什么；反查：某仓库是第几个收藏。
 * - 1. order 语义：1 = 最早（2012 年的第一颗星），N = 最新；同秒并列由 (时间, 仓库名) 稳定排序区分
 *
 * 用法：bun scripts/../tools/.../star-at.ts <序号|仓库名>   例：star-at.ts 1000 / star-at.ts colinhacks/zod
 */
import path from "node:path";

import { sourceDir } from "../../scripts/lib.ts";

async function main() {
  const q = process.argv[2];
  if (!q) {
    console.error("用法：star-at.ts <收藏序号 N | owner/repo>");
    process.exit(2);
  }
  const stars: {
    count: number;
    repos: {
      full_name: string;
      html_url: string;
      description: string;
      starred_at: string;
      order: number;
      stars: number;
    }[];
  } = JSON.parse(await Bun.file(path.join(sourceDir("github-stars"), "stars.json")).text());

  if (/^\d+$/.test(q)) {
    const n = Number(q);
    const hit = stars.repos.find((r) => r.order === n);
    if (!hit) {
      console.log(`#${n}：不在 1..${stars.count} 范围内`);
      return;
    }
    console.log(`#${n} · [${hit.full_name}](${hit.html_url})`);
    console.log(`  收藏于 ${hit.starred_at} · ⭐${hit.stars}`);
    if (hit.description) console.log(`  ${hit.description.slice(0, 100)}`);
  } else {
    const hit = stars.repos.find((r) => r.full_name.toLowerCase() === q.toLowerCase());
    if (!hit) {
      console.log(`收藏里没有 ${q}`);
      process.exit(1);
    }
    console.log(
      `${hit.full_name} 是第 ${hit.order} 个收藏（共 ${stars.count} 个）· 收藏于 ${hit.starred_at}`,
    );
  }
}

main();
