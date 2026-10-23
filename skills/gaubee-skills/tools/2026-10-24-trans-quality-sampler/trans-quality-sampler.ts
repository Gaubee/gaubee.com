#!/usr/bin/env bun
/**
 * trans-quality-sampler — X 译文质量抽查器（3120+ 条库存的人工抽检辅助）
 *
 * 翻译管道只有覆盖门禁（translations-doctor）没有质量闭环；本工具随机抽样
 * 原文/译文对照输出成 markdown，附机械特征统计（URL 保留率、emoji 保留率、
 * 疑似漏翻），供人工快速过目——覆盖「翻没翻」之外的第二问「翻得好不好」。
 *
 * 用法：bun tools/2026-10-24-trans-quality-sampler/trans-quality-sampler.ts [--n 12] [--seed 42] [--md 路径]
 * 退出码：0 = 正常；1 = 数据缺失。零网络、秒级退出、不写数据（--md 只写抽样报告文件）。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const DATA = process.env.GAUBEE_SKILLS_DATA ?? path.join(os.homedir(), ".gaubee-skills", "data");
const XJSON = path.join(DATA, "sources", "x-likes", "x.json");
const ZH = path.resolve(import.meta.dir, "..", "..", "translations", "x-tweets.zh.json");

const URL_RE = /https?:\/\/[^\s]+/g;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;

interface Sample {
  id: string;
  src: string;
  dst: string;
  ratio: number; // 译文字符数 / 原文字符数
  urlsSrc: number;
  urlsDst: number;
  emojiSrc: number;
  emojiDst: number;
  suspicious: string[]; // 疑似问题标签
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function main(): number {
  const argv = process.argv.slice(2);
  const n = Math.max(1, Number(argv[argv.indexOf("--n") + 1] ?? 12) || 12);
  const seed = Number(argv[argv.indexOf("--seed") + 1] ?? 42) || 42;
  const mdIdx = argv.indexOf("--md");
  const mdPath = mdIdx >= 0 ? argv[mdIdx + 1] : undefined;

  if (!existsSync(XJSON) || !existsSync(ZH)) {
    console.error(`数据缺失：${XJSON} 或 ${ZH}`);
    return 1;
  }
  const x = JSON.parse(readFileSync(XJSON, "utf8")) as { items: Record<string, { text?: string }> };
  const zh = JSON.parse(readFileSync(ZH, "utf8")) as Record<string, string>;

  const ids = Object.keys(zh).filter((id) => x.items[id]?.text);
  const rnd = mulberry32(seed);
  const picked = [...ids].sort(() => rnd() - 0.5).slice(0, n);

  const samples: Sample[] = picked.map((id) => {
    const src = x.items[id]!.text ?? "";
    const dst = zh[id] ?? "";
    const urlsSrc = src.match(URL_RE)?.length ?? 0;
    const urlsDst = dst.match(URL_RE)?.length ?? 0;
    const emojiSrc = src.match(EMOJI_RE)?.length ?? 0;
    const emojiDst = dst.match(EMOJI_RE)?.length ?? 0;
    const suspicious: string[] = [];
    if (urlsDst < urlsSrc) suspicious.push("URL 减少");
    if (urlsDst > urlsSrc && /https?:\/\/t\.co\//.test(dst)) suspicious.push("t.co 残留（原文无此链）");
    if (emojiDst < emojiSrc) suspicious.push("emoji 减少");
    if (dst.trim() === src.trim() && !URL_RE.test(src) && /[\u4e00-\u9fff]/.test(src) === false && /[A-Za-z]{4,}/.test(src))
      suspicious.push("疑似漏翻（译文=原文）");
    if (!dst.trim()) suspicious.push("空译文");
    return { id, src, dst, ratio: src.length ? dst.length / src.length : 0, urlsSrc, urlsDst, emojiSrc, emojiDst, suspicious };
  });

  const urlKeep = samples.filter((s) => s.urlsSrc === 0 || s.urlsDst >= s.urlsSrc).length;
  const emojiKeep = samples.filter((s) => s.emojiSrc === 0 || s.emojiDst >= s.emojiSrc).length;
  const flagged = samples.filter((s) => s.suspicious.length);

  const lines: string[] = [];
  lines.push(`# 译文质量抽样（n=${n}，seed=${seed}，总库 ${Object.keys(zh).length}）`);
  lines.push("");
  lines.push(`URL 保留 ${urlKeep}/${n}｜emoji 保留 ${emojiKeep}/${n}｜机械红旗 ${flagged.length} 条`);
  lines.push("");
  for (const s of samples) {
    lines.push(`## ${s.id}（长比 ${s.ratio.toFixed(2)}${s.suspicious.length ? `；⚠ ${s.suspicious.join("、")}` : ""}）`);
    lines.push(`- 原：${s.src.replace(/\n+/g, " ⏎ ")}`);
    lines.push(`- 译：${s.dst.replace(/\n+/g, " ⏎ ")}`);
    lines.push("");
  }
  const report = lines.join("\n");
  if (mdPath) {
    writeFileSync(mdPath, report);
    console.log(`报告 → ${mdPath}`);
  } else {
    console.log(report);
  }
  console.log(`汇总：URL 保留 ${urlKeep}/${n}｜emoji 保留 ${emojiKeep}/${n}｜红旗 ${flagged.length}${flagged.length ? `（${flagged.map((s) => s.id).join(",")}）` : ""}`);
  return 0;
}

process.exit(main());
