#!/usr/bin/env bun
/**
 * morning-brief — 06:00 自动抓取跑完后的「一屏摘要」
 *
 * 背景（2026-11-18）：每日机械步骤交给 launchd 后，06:30 的 agent 接手时第一件事是
 * 判断「昨晚那轮到底跑成什么样」：有没有硬失败、各源抓到多少、媒体换代到几、
 * 还有哪些判断类工作没做。原来只能 tail 日志（几十行）再逐个文件对数字。
 *
 * 本工具把这些折成一屏：跑批结果 → 各源变更 → 媒体与译文水位 → 待办清单。
 * 只读，不触发任何抓取。
 *
 * 用法：
 *   bun tools/2026-11-18-morning-brief/morning-brief.ts
 *   bun tools/2026-11-18-morning-brief/morning-brief.ts --date 2026-11-17   # 指定报告日
 * 退出码：0 = 摘要已出（有无失败都 0）；2 = 数据缺失。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DATA = process.env.GAUBEE_SKILLS_DATA ?? path.join(os.homedir(), ".gaubee-skills", "data");
const SITE = process.env.GAUBEE_SITE ?? path.resolve(import.meta.dir, "..", "..", "..", "..");
const AUTOMATION = path.join(DATA, "..", "automation");
const SKILL = path.join(SITE, "skills", "gaubee-skills");

const ymd = (d: Date): string => d.toLocaleDateString("sv-SE");
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const argv = process.argv.slice(2);
const di = argv.indexOf("--date");
const REPORT_DAY = di >= 0 ? argv[di + 1]! : ymd(addDays(new Date(), -1));
const RUN_DAY = ymd(addDays(new Date(`${REPORT_DAY}T12:00:00`), 1));

interface StepResult {
  name: string;
  status: string;
  seconds: number;
  detail: string;
}
interface Receipt {
  at?: string;
  today?: string;
  results?: StepResult[];
  hardFails?: string[];
  softFails?: string[];
}

function readJson<T>(file: string): T | null {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

function changeCounts(source: string, date: string): { a: number; r: number; c: number } | null {
  const j = readJson<{ added?: unknown[]; removed?: unknown[]; changed?: unknown[] }>(
    path.join(DATA, "sources", source, "changes", `${date}.json`),
  );
  if (!j) return null;
  return { a: j.added?.length ?? 0, r: j.removed?.length ?? 0, c: j.changed?.length ?? 0 };
}

function main(): number {
  console.log(`morning-brief：报告日 ${REPORT_DAY}（抓取日 ${RUN_DAY}）`);

  // 1) 06:00 跑批结果。优先读当日账本的第一条（真正的首轮抓取），
  //    因为 last-run-fetch.json 会被 06:30 的幂等补齐覆盖成「9 ok / 5 skip」。
  const ledgerFile = path.join(AUTOMATION, `runs-${RUN_DAY}.jsonl`);
  let receipt: Receipt | null = null;
  let runCount = 0;
  if (existsSync(ledgerFile)) {
    const lines = readFileSync(ledgerFile, "utf8").split("\n").filter((l) => l.trim());
    runCount = lines.length;
    for (const line of lines) {
      try {
        const one = JSON.parse(line) as Receipt;
        if (one.stage === "fetch" || !one.stage) {
          receipt = one;
          break;
        }
      } catch {
        // 跳过坏行
      }
    }
  }
  if (!receipt) receipt = readJson<Receipt>(path.join(AUTOMATION, "last-run-fetch.json"));

  if (receipt?.results) {
    const ok = receipt.results.filter((r) => r.status === "ok").length;
    const skip = receipt.results.filter((r) => r.status === "skip").length;
    const fail = receipt.results.filter((r) => r.status === "fail");
    const when = receipt.at ? new Date(receipt.at).toLocaleString("sv-SE") : "?";
    console.log(
      `\n[跑批] 首轮 ${when}  ok ${ok} / skip ${skip} / fail ${fail.length}` +
        (runCount > 1 ? `（当日共 ${runCount} 轮，之后的是幂等补齐）` : ""),
    );
    if (receipt.hardFails?.length) console.log(`  硬失败：${receipt.hardFails.join("、")}（需先修，否则日报会引用未入卷媒体）`);
    if (receipt.softFails?.length) console.log(`  软失败：${receipt.softFails.join("、")}（判断是否影响今日日报）`);
    for (const f of fail) console.log(`  ✗ ${f.name}：${f.detail.slice(0, 100)}`);
  } else {
    console.log("\n[跑批] 没有 receipt（06:00 那轮没跑成，需要手动跑 daily-auto --stage fetch）");
  }

  // 2) 各源变更
  console.log("\n[变更]");
  const stars = changeCounts("github-stars", RUN_DAY);
  console.log(
    `  星标（抓取日 ${RUN_DAY}）：${
      stars ? `新增 ${stars.a} / 移除 ${stars.r} / 元数据 ${stars.c}` : "无 changes 文件"
    }`,
  );
  const deps = changeCounts("github-deps", RUN_DAY);
  console.log(
    `  依赖：${deps ? `新技术首见 ${deps.a} / 变更仓库 ${deps.c}` : "无 changes 文件"}`,
  );
  const x = changeCounts("x-likes", RUN_DAY);
  console.log(`  X（抓取日 ${RUN_DAY}）：${x ? `${x.a} 条新增` : "无 changes 文件"}`);

  const commits = readJson<{ totalCommits?: number; pushes?: Array<{ repo: string; count: number; private?: boolean }> }>(
    path.join(DATA, "sources", "github-commits", "history", `${REPORT_DAY}.json`),
  );
  if (commits?.pushes) {
    const priv = commits.pushes.filter((p) => /fde2e|keel|bu|omni/.test(p.repo));
    const pubCount = commits.totalCommits! - priv.reduce((n, p) => n + p.count, 0);
    console.log(`  提交（${REPORT_DAY}）：${commits.totalCommits} 条（公开约 ${pubCount} + 私有 ${priv.reduce((n, p) => n + p.count, 0)}）`);
  } else {
    console.log(`  提交（${REPORT_DAY}）：无 history 文件`);
  }

  // 3) 媒体与译文水位
  const pointer = readJson<{ gen?: number }>(path.join(SITE, "cdn-media", "manifest", "current.json"));
  const manifestFile = pointer?.gen
    ? path.join(SITE, "cdn-media", "manifest", `manifest-${pointer.gen}.json`)
    : "";
  const manifest = manifestFile ? readJson<{ object_count?: number }>(manifestFile) : null;
  console.log(`\n[水位] 媒体 gen ${pointer?.gen ?? "?"}（${manifest?.object_count ?? "?"} 对象）`);
  const stagingDir = path.join(SITE, "cdn-media", "staging", "x");
  let stagingFiles = 0;
  if (existsSync(stagingDir)) {
    for (const month of readdirSync(stagingDir)) {
      const p = path.join(stagingDir, month);
      try {
        stagingFiles += readdirSync(p).length;
      } catch {
        // 忽略非目录
      }
    }
  }
  console.log(`       staging ${stagingFiles} 个文件`);

  // 4) 待办（判断类工作是否已做）
  console.log("\n[待办]");
  const xReport = path.join(SKILL, "reports", "daily", `${REPORT_DAY}-x.md`);
  const ghReport = path.join(SKILL, "reports", "daily", `${REPORT_DAY}.md`);
  console.log(`  X 日报：${existsSync(xReport) ? "已生成" : "未生成"}`);
  console.log(`  GitHub 日报：${existsSync(ghReport) ? "已写" : "未写"}`);
  const eventsDir = path.join(SITE, "src", "content", "events");
  const published = existsSync(eventsDir)
    ? readdirSync(eventsDir).filter((f) => f.includes(REPORT_DAY)).length
    : 0;
  console.log(`  已发布 event（${REPORT_DAY}）：${published} 个（应为 2）`);
  console.log("  其余判断类工作：taxonomy 策展、译文、周报（周一）、工坊、发布、验收");
  return 0;
}

process.exit(main());
