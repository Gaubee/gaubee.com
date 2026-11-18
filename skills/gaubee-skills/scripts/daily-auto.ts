#!/usr/bin/env bun
/**
 * daily-auto — 把每日维护里「确定性的部分」做成一条幂等命令
 *
 * 背景（kzf 2026-11-17）：每日 06:30 的定时任务原来要一步步手跑十几条命令
 * （抓星标、抓提交、扫依赖、抓 X、下载媒体、打卷、发布、生成、四道门禁、三项审计），
 * 这些动作每天都在做同样的事，却占用 agent 的执行时间与上下文。做法是把它们收进本脚本，
 * 让定时任务只负责「判断与写作」：改 taxonomy、写日报、造工具、发布、验收。
 *
 * 幂等设计（关键）：每个步骤先看「今天的产物在不在」，在就跳过。
 *   - 星标/提交/依赖/X 的 changes/<date>.json 已存在 → 跳过抓取
 *     （重抓会把差分窗口切成两段，破坏归窗口径，见 SKILL.md §8）
 *   - 媒体 --patch 报「无新增」→ 跳过 publish 与子仓提交
 *   - 译文导出每次重跑（它只读不写数据，输出到 /tmp 供 agent 翻译）
 * 因此本脚本可以在 05:30 跑一次、06:30 再跑一次：第二次全是跳过，只补失败项。
 *
 * 三个阶段（可分开跑，也可 --stage all）：
 *   fetch     抓取 + 富化 + 媒体入卷 + 硬门 + 译文导出
 *   finalize  合并译文 + 生成 X 日报 + 四道门禁 + 三项审计 + 人话腔指标
 *   verify    CI / ssh / manifest 对账 / HLS / 部署冒烟
 *
 * 不做的事（留给 agent，属判断类）：
 *   - taxonomy 策展与归类
 *   - GitHub 日报正文、周/月/年报分析
 *   - 工具工坊
 *   - publish 到站点（对外发布，逐份单独执行并先 --dry）
 *
 * 用法：
 *   bun scripts/daily-auto.ts --stage fetch
 *   bun scripts/daily-auto.ts --stage finalize
 *   bun scripts/daily-auto.ts --stage verify
 *   bun scripts/daily-auto.ts --stage all [--dry] [--force]
 * 退出码：0 = 全部硬步骤成功；1 = 有硬步骤失败（收据里列出）；2 = 用法错误。
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const SKILL = path.resolve(import.meta.dir, "..");
const SITE = process.env.GAUBEE_SITE ?? path.resolve(SKILL, "..", "..");
const DATA = process.env.GAUBEE_SKILLS_DATA ?? path.join(os.homedir(), ".gaubee-skills", "data");
const CDN = path.join(SITE, "cdn-media");
const REPORTS = path.join(SKILL, "reports", "daily");
const RECEIPT_DIR = path.join(DATA, "..", "automation");

const BUN = process.execPath;

type Hardness = "hard" | "soft";

interface StepResult {
  name: string;
  status: "ok" | "skip" | "fail";
  seconds: number;
  detail: string;
  hardness: Hardness;
  /** 完整输出（只用于同一次运行内的判断，不写进收据） */
  out?: string;
}

const ymd = (d: Date): string => d.toLocaleDateString("sv-SE");
const addDays = (d: Date, n: number): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const TODAY = ymd(new Date());
const YESTERDAY = ymd(addDays(new Date(), -1));

const argv = process.argv.slice(2);
const argOf = (f: string): string | undefined => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const stage = argOf("--stage") ?? "all";
const dry = argv.includes("--dry");
const force = argv.includes("--force");

const results: StepResult[] = [];

/** 跑一条命令，返回是否成功；输出写日志文件，只回显尾部 */
function run(name: string, cmd: string[], opts: { cwd?: string; timeoutSec?: number; silence?: boolean } = {}): StepResult {
  const started = Date.now();
  const timeout = (opts.timeoutSec ?? 300) * 1000;
  if (dry) {
    console.log(`  · [dry] ${name}`);
    return { name, status: "skip", seconds: 0, detail: "dry-run", hardness: "soft" };
  }
  const r = spawnSync(cmd[0]!, cmd.slice(1), {
    cwd: opts.cwd ?? SKILL,
    encoding: "utf8",
    timeout,
    maxBuffer: 32 * 1024 * 1024,
    env: process.env,
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const secs = Math.round((Date.now() - started) / 100) / 10;
  const ok = r.status === 0;
  const tail = out.trim().split("\n").filter((l) => l.trim()).slice(-2).join(" | ").slice(0, 180);
  console.log(`  ${ok ? "✓" : "✗"} ${name}（${secs}s）${opts.silence ? "" : ` ${tail}`}`);
  return { name, status: ok ? "ok" : "fail", seconds: secs, detail: tail, hardness: "soft", out };
}

function bun(...args: string[]): string[] {
  return [BUN, ...args];
}

function push(r: StepResult, hardness: Hardness): void {
  r.hardness = hardness;
  results.push(r);
  if (r.status === "skip") console.log(`  · ${r.name}：跳过（${r.detail}）`);
  // soft 失败只记一条提示，不中断后续步骤（某源失败要继续跑其它源）
  if (r.status === "fail" && hardness === "soft") {
    console.log(`    （soft 失败，继续）`);
  }
}

/** 某源的今日/昨日 changes 是否已存在（幂等判据） */
function hasChanges(source: string, date: string): boolean {
  return existsSync(path.join(DATA, "sources", source, "changes", `${date}.json`));
}

// ---------------------------------------------------------------- fetch

function stageFetch(): void {
  console.log(`\n[fetch] 抓取与入卷（today=${TODAY} yesterday=${YESTERDAY}）`);

  push(run("环境自检", bun("tools/2026-10-09-pipeline-env-doctor/pipeline-env-doctor.ts")), "hard");

  // 星标：今日 changes 已存在则跳过（重抓会破坏差分窗口）
  if (!force && hasChanges("github-stars", TODAY)) {
    push({ name: "星标抓取与差分", status: "skip", seconds: 0, detail: `changes/${TODAY}.json 已在` }, "soft");
  } else {
    push(run("星标抓取", bun("scripts/github-stars-fetch.ts"), { timeoutSec: 400 }), "hard");
    push(run("星标差分", bun("scripts/github-stars-diff.ts"), { timeoutSec: 150 }), "hard");
  }

  // 提交：昨日 changes 已存在则跳过
  if (!force && hasChanges("github-commits", YESTERDAY)) {
    push({ name: "提交抓取", status: "skip", seconds: 0, detail: `changes/${YESTERDAY}.json 已在` }, "soft");
  } else {
    push(run(`提交抓取 ${YESTERDAY}`, bun("scripts/github-commits-fetch.ts", YESTERDAY), { timeoutSec: 500 }), "hard");
  }

  // 依赖：数百请求，慢；今日 changes 已存在则跳过
  if (!force && hasChanges("github-deps", TODAY)) {
    push({ name: "依赖扫描", status: "skip", seconds: 0, detail: `changes/${TODAY}.json 已在` }, "soft");
  } else {
    push(run("依赖扫描", bun("scripts/github-deps-fetch.ts"), { timeoutSec: 900 }), "soft");
  }

  push(run("技能 Graph", bun("scripts/tech-graph-build.ts"), { timeoutSec: 300 }), "hard");
  push(run("Graph 展示页", bun("scripts/build-graph-page.ts"), { timeoutSec: 150 }), "soft");
  push(run("站点 Graph 投影", bun("scripts/sync-site-graph.ts"), { timeoutSec: 150 }), "hard");

  // X：会话失效时跳过抓取但继续其它源
  const probe = run("X 会话探针", bun("tools/2026-10-22-x-session-probe/x-session-probe.ts"), { timeoutSec: 150 });
  push(probe, "soft");
  if (probe.status === "fail") {
    console.log("    X 会话不可用，跳过 X 抓取与富化（其它源继续）");
  } else if (!force && hasChanges("x-likes", TODAY)) {
    push({ name: "X 抓取", status: "skip", seconds: 0, detail: `changes/${TODAY}.json 已在` }, "soft");
  } else {
    push(run("X 抓取", bun("scripts/x-likes-fetch.ts"), { timeoutSec: 580 }), "soft");
    push(run("X 富化", bun("scripts/x-media-backfill.ts"), { timeoutSec: 580 }), "soft");
    push(run("X 封面", bun("scripts/x-posters.ts"), { timeoutSec: 500 }), "soft");
  }

  // 媒体入卷：--patch 无新增时跳过 publish
  const pack = run("媒体打包", bun("tools/media-pack.ts", "--patch"), { cwd: CDN, timeoutSec: 400 });
  push(pack, "hard");
  const noNew = pack.status === "ok" && /无新增|新增 0 文件/.test(pack.detail);
  if (noNew) {
    push({ name: "媒体发布", status: "skip", seconds: 0, detail: "无新增对象" }, "soft");
  } else if (pack.status === "ok") {
    push(run("媒体发布", bun("tools/media-pack.ts", "--publish"), { cwd: CDN, timeoutSec: 600 }), "hard");
    push(run("cdn-media 子仓提交", ["git", "add", "manifest/current.json", "manifest/"], { cwd: CDN, timeoutSec: 60 }), "hard");
    // 子仓必须单独推送：主仓 gitlink 更新不会顺带推子仓（2026-11-15 实证）
    // 提交信息带上卷名与文件数，否则这条提交进日报时只剩「gen 换代」四个字（2026-11-19 实证）
    const tarName = pack.out?.match(/patch-\d{4}-\d{2}-\d{2}(?:-\d+)?\.tar/)?.[0] ?? `${TODAY} 补丁卷`;
    const fileCount = pack.out?.match(/(\d+)\s*新对象/)?.[1] ?? "?";
    // 媒体打包日志形如 `完成: gen 37 → 38`，取箭头后的新代号（取第一个会拿到旧代号）
    const gen = pack.out?.match(/gen\s*\d+\s*→\s*(\d+)/)?.[1];
    const commit = run(
      "cdn-media 子仓 commit",
      ["git", "commit", "-m", `📦 gen ${gen ?? "?"}：${tarName}（${fileCount} 文件）`],
      { cwd: CDN, timeoutSec: 60, silence: true },
    );
    push(commit, "soft");
    push(run("cdn-media 子仓 push", ["git", "push", "origin", "main"], { cwd: CDN, timeoutSec: 180 }), "hard");
  }

  push(run("媒体元数据", bun("scripts/media-meta.ts"), { timeoutSec: 300 }), "hard");
  push(
    run("发布硬门", bun("tools/2026-10-05-x-media-audit/x-media-audit.ts", "--require-packed"), { timeoutSec: 300 }),
    "hard",
  );

  // 译文导出：交给 agent 翻译；导出本身幂等
  push(run("译文导出", bun("scripts/x-translations-export.ts"), { timeoutSec: 250 }), "soft");
}

// ------------------------------------------------------------- finalize

function stageFinalize(): void {
  console.log(`\n[finalize] 生成与门禁（report day=${YESTERDAY}）`);

  // 合并译文：仅当 agent 已产出 out-NN.json
  const transDir = "/tmp/x-trans";
  const hasOut = existsSync(transDir) && readdirSync(transDir).some((f) => /^out-\d+\.json$/.test(f));
  if (hasOut) {
    push(run("译文校验", bun("scripts/x-translations-export.ts", "--verify"), { timeoutSec: 120 }), "soft");
    push(run("译文合并", bun("scripts/x-translations-merge.ts"), { timeoutSec: 120 }), "hard");
  } else {
    push({ name: "译文合并", status: "skip", seconds: 0, detail: "没有 out-NN.json（未翻译）" }, "soft");
  }

  push(run("X 日报生成", bun("scripts/x-daily-events.ts", "--date", YESTERDAY), { timeoutSec: 200 }), "hard");

  const gates: Array<[string, string]> = [
    ["归窗防线", "tools/2026-11-04-x-daily-guard/x-daily-guard.ts"],
    ["译文覆盖", "tools/2026-11-07-x-daily-trans-coverage/x-daily-trans-coverage.ts"],
    ["线程缺链", "tools/2026-11-08-x-daily-thread-gaps/x-daily-thread-gaps.ts"],
    ["陈旧稿", "tools/2026-11-09-x-daily-staleness/x-daily-staleness.ts"],
  ];
  for (const [name, script] of gates) {
    push(run(`X 门禁：${name}`, bun(script, "--date", YESTERDAY), { timeoutSec: 150 }), "hard");
  }

  // report-lint 会长期报同一批历史累计漂移（改名被当新增、starred_at 被上游改写）。
  // 归因工具能证明这些是历史事实时，就不把它当失败——否则每天都要人重复判断一次。
  push(run("报告一致性", bun("tools/2026-11-06-report-lint/report-lint.ts"), { timeoutSec: 250 }), "soft");
  const attrib = run(
    "星标累计归因",
    bun("tools/2026-11-16-star-cumulative-attribution/star-cumulative-attribution.ts"),
    { timeoutSec: 200 },
  );
  push(attrib, "soft");
  const explained = /全部 \d+ 份都有归因/.test(attrib.out ?? "");
  const lint = results.find((r) => r.name === "报告一致性");
  if (lint?.status === "fail" && explained) {
    lint.status = "skip";
    lint.detail = "全部漂移已归因（历史改名/修订，非算术错）";
    console.log("  · 报告一致性失败已由归因工具解释，降级为提示");
  }
  push(run("提交计数对账", bun("tools/2026-11-12-report-commit-count-audit/report-commit-count-audit.ts"), { timeoutSec: 250 }), "soft");
  push(run("taxonomy 链接自洽", bun("tools/2026-11-17-taxo-note-guard/taxo-note-guard.ts"), { timeoutSec: 120 }), "soft");

  // 人话腔：只把 RED 当问题，LOW/YELLOW 是「材料稀薄」提示不算错。
  // ai-tone-metrics 对 LOW 也返回非 0，所以这里不能用 run() 的成功/失败判定。
  if (dry) {
    console.log("  · [dry] 人话腔指标");
  } else {
    const red = readToneRed();
    const ok = red === 0;
    console.log(`  ${ok ? "✓" : "✗"} 人话腔指标（RED ${red}）`);
    results.push({
      name: "人话腔指标",
      status: ok ? "ok" : "fail",
      seconds: 0,
      detail: `RED ${red}`,
      hardness: "soft",
    });
  }
}

/** 从 ai-tone-metrics 的输出里数 RED 行（脚本本身对 LOW/YELLOW 也返回非 0） */
function readToneRed(): number {
  const r = spawnSync("node", ["scripts/ai-tone-metrics.mjs"], { cwd: SKILL, encoding: "utf8", timeout: 200_000 });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  return out.split("\n").filter((l) => /\bRED\s*$/.test(l.trim())).length;
}

// --------------------------------------------------------------- verify

function stageVerify(): void {
  console.log(`\n[verify] 收敛验收`);
  push(run("ssh 通道", bun("tools/2026-10-30-ssh-channel-doctor/ssh-channel-doctor.ts"), { timeoutSec: 120 }), "soft");
  push(run("manifest 对账", bun("tools/2026-10-15-manifest-lag-watch/manifest-lag-watch.ts"), { timeoutSec: 150 }), "soft");
  push(run("HLS 抽检", bun("tools/2026-10-21-hls-live-check/hls-live-check.ts", "--limit", "6"), { timeoutSec: 400 }), "soft");
  push(run("部署冒烟", bun("tools/2026-10-13-deploy-smoke/deploy-smoke.ts", "--n", "4"), { timeoutSec: 300 }), "soft");
  const ci = run("CI 状态", ["gh", "run", "list", "--repo", "Gaubee/gaubee.com", "--limit", "1", "--json", "status,conclusion", "-q", '.[] | "\\(.status) \\(.conclusion // \"-\")"'], { timeoutSec: 90 });
  // gh 对「构建中」也返回 0；这里要区分「绿」与「还没跑完」，别把 in_progress 当通过
  if (ci.status === "ok" && /in_progress|queued|pending/.test(ci.out ?? "")) {
    ci.status = "skip";
    ci.detail = "CI 构建中（稍后复跑 verify）";
    console.log("  · CI 仍在构建，未判定为绿");
  }
  push(ci, "soft");
}

// ----------------------------------------------------------------- main

function writeReceipt(): string {
  if (!existsSync(RECEIPT_DIR)) mkdirSync(RECEIPT_DIR, { recursive: true });
  const file = path.join(RECEIPT_DIR, `last-run-${stage}.json`);
  const payload = {
    stage,
    at: new Date().toISOString(),
    today: TODAY,
    yesterday: YESTERDAY,
    dry,
    results: results.map(({ out: _out, ...rest }) => rest),
    hardFails: results.filter((r) => r.status === "fail" && r.hardness === "hard").map((r) => r.name),
    softFails: results.filter((r) => r.status === "fail" && r.hardness === "soft").map((r) => r.name),
  };
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  // 按天追加：last-run 只留最后一次，会把 06:00 那轮（真正的抓取）覆盖成 06:30 的幂等补齐。
  // 06:30 接手时要判断的是「首轮跑成什么样」，所以每次运行都追加一行历史（dry-run 不入账）。
  if (!dry) {
    const ledger = path.join(RECEIPT_DIR, `runs-${TODAY}.jsonl`);
    try {
      appendFileSync(ledger, `${JSON.stringify({ ...payload, results: payload.results })}\n`, "utf8");
    } catch {
      // 账本写失败不影响主流程
    }
  }
  return file;
}

function main(): number {
  if (!["fetch", "finalize", "verify", "all"].includes(stage)) {
    console.error("用法：--stage fetch|finalize|verify|all [--dry] [--force]");
    return 2;
  }
  console.log(`daily-auto：stage=${stage} today=${TODAY} yesterday=${YESTERDAY}${dry ? "（dry-run）" : ""}`);

  if (stage === "fetch" || stage === "all") stageFetch();
  if (stage === "finalize" || stage === "all") stageFinalize();
  if (stage === "verify" || stage === "all") stageVerify();

  const receipt = writeReceipt();
  const ok = results.filter((r) => r.status === "ok").length;
  const skip = results.filter((r) => r.status === "skip").length;
  const hardFails = results.filter((r) => r.status === "fail" && r.hardness === "hard");
  const softFails = results.filter((r) => r.status === "fail" && r.hardness === "soft");
  console.log(`\n收据：ok ${ok} / skip ${skip} / hard-fail ${hardFails.length} / soft-fail ${softFails.length} → ${receipt}`);
  if (softFails.length) {
    console.log(`soft 失败（需人看，不阻断）：${softFails.map((r) => r.name).join("、")}`);
  }
  if (hardFails.length) {
    console.error(`硬失败：${hardFails.map((r) => `${r.name}（${r.detail}）`).join("、")}`);
    return 1;
  }
  console.log("daily-auto OK：本阶段全部硬步骤完成");
  return 0;
}

process.exit(main());
