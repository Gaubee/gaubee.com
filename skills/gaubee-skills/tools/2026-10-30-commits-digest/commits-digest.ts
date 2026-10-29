#!/usr/bin/env bun
/**
 * commits-digest — 日报提交素材一条命令
 *
 * 每天写 GitHub 日报都要手搓 jq：各仓推送计数、公开仓明细、私有仓样本消息。
 * 本工具读 history/<date>.json 一次性输出日报写作素材：各仓分布（公/私标注）、
 * 公开仓 changes 明细、私有仓每仓首条提交消息样本（只进本地，写作时人工提炼）。
 *
 * 用法：bun tools/2026-10-30-commits-digest/commits-digest.ts [YYYY-MM-DD]
 *   默认昨天。退出码：0 = 有素材；1 = 无当日 history。
 * 输出含私有仓提交消息——只供本地写作参考，写入日报前必须重写为人话总结。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const DATA = process.env.GAUBEE_SKILLS_DATA ?? path.join(os.homedir(), ".gaubee-skills", "data");

interface Push {
  repo: string;
  private: boolean;
  count: number;
  commits: { message?: string }[];
}

function main(): number {
  const argv = process.argv.slice(2);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(argv[0] ?? "")
    ? argv[0]!
    : new Date(Date.now() - 24 * 3600_000).toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
  const f = path.join(DATA, "sources", "github-commits", "history", `${date}.json`);
  if (!existsSync(f)) {
    console.error(`无当日 history：${f}`);
    return 1;
  }
  const j = JSON.parse(readFileSync(f, "utf8")) as { pushes?: Push[] };
  const pushes = [...(j.pushes ?? [])].sort((a, b) => b.count - a.count);
  const pub = pushes.filter((p) => !p.private);
  const priv = pushes.filter((p) => p.private);
  console.log(`# ${date} 提交素材（公开 ${pub.reduce((s, p) => s + p.count, 0)} 条 / 私有 ${priv.reduce((s, p) => s + p.count, 0)} 条）`);
  console.log("");
  console.log("## 分布");
  for (const p of pushes) console.log(`- ${p.repo}（${p.private ? "私有" : "公开"}）：${p.count} 条`);
  console.log("");
  console.log("## 私有仓样本（首条/最长条消息，本地素材勿直发）");
  for (const p of priv) {
    const msg = (p.commits ?? [])
      .map((c) => c.message ?? "")
      .sort((a, b) => b.length - a.length)[0] ?? "";
    const one = msg.split("\n")[0]?.slice(0, 160) ?? "(无消息)";
    console.log(`- ${p.repo}（${p.count} 条）：${one}`);
  }
  return 0;
}

process.exit(main());
