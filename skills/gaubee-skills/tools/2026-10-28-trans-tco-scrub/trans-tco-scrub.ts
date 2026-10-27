#!/usr/bin/env bun
/**
 * trans-tco-scrub — 译文 t.co 残留全库扫描与清洗
 *
 * 背景（2026-10-24 trans-quality-sampler 首跑实证）：部分历史译文尾部残留原文
 * 没有的 t.co 短链（早期合并管道把展开失败的短链带进了译文）。本工具全库扫描
 * 「译文含 t.co 且原文不含同一链接」的条目；--fix 剥离残留（只删译文里多余的
 * t.co，原文有的不动），写回 translations/x-tweets.zh.json。
 *
 * 用法：bun tools/2026-10-28-trans-tco-scrub/trans-tco-scrub.ts [--fix]
 * 退出码：0 = 无残留或清洗成功；1 = 数据缺失。零网络。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const DATA = process.env.GAUBEE_SKILLS_DATA ?? path.join(os.homedir(), ".gaubee-skills", "data");
const XJSON = path.join(DATA, "sources", "x-likes", "x.json");
const ZH = path.resolve(import.meta.dir, "..", "..", "translations", "x-tweets.zh.json");

const TCO = /https?:\/\/t\.co\/[A-Za-z0-9]+/g;

function main(): number {
  const fix = process.argv.includes("--fix");
  if (!existsSync(XJSON) || !existsSync(ZH)) {
    console.error(`数据缺失：${XJSON} 或 ${ZH}`);
    return 1;
  }
  const x = JSON.parse(readFileSync(XJSON, "utf8")) as { items: Record<string, { text?: string }> };
  const zh = JSON.parse(readFileSync(ZH, "utf8")) as Record<string, string>;

  const bad: { id: string; links: string[] }[] = [];
  for (const [id, dst] of Object.entries(zh)) {
    const dstLinks = new Set(dst.match(TCO) ?? []);
    if (!dstLinks.size) continue;
    const srcLinks = new Set((x.items[id]?.text ?? "").match(TCO) ?? []);
    const extra = [...dstLinks].filter((l) => !srcLinks.has(l));
    if (extra.length) bad.push({ id, links: extra });
  }

  if (!bad.length) {
    console.log(`全库 ${Object.keys(zh).length} 条译文：无 t.co 残留`);
    return 0;
  }
  const total = bad.reduce((s, b) => s + b.links.length, 0);
  console.log(`残留 ${bad.length} 条（共 ${total} 个多余 t.co）：`);
  for (const b of bad.slice(0, 15)) console.log(`  ${b.id}：${b.links.join(" ")}`);
  if (bad.length > 15) console.log(`  … 共 ${bad.length} 条`);
  if (!fix) {
    console.log("（dry：加 --fix 剥离）");
    return 0;
  }
  let n = 0;
  for (const b of bad) {
    let dst = zh[b.id]!;
    for (const l of b.links) dst = dst.split(l).join("");
    zh[b.id] = dst.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trimEnd();
    n++;
  }
  writeFileSync(ZH, JSON.stringify(zh, null, 2) + "\n");
  console.log(`已清洗 ${n} 条 → ${ZH}`);
  return 0;
}

process.exit(main());
