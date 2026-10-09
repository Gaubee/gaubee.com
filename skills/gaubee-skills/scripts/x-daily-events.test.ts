// x-daily-events 夹具测试（2026-10-09 X 内容管道统一）
//   bun test skills/gaubee-skills/scripts/x-daily-events.test.ts
//
// 覆盖（统一归窗口径，kzf 2026-10-09 方案 a）：
// - liked/bookmarked 抓取差分归属：changes/<run-date>.json added 回查 x.json，
//   条目 created_at（推文发布时刻）不参与归窗（老推文现在赞也归本期）
// - 存量回退：无任何 changes 记录的基线前赞，按 created_at 时间窗回退（2026-10-09 细则）
// - posted/reposted 按 created_at 本地日窗（窗外条目排除）
// - 同条目既在差分又在时间窗 → id 去重只出一次
// - 差分回查 x.json 未命中 → 计数警告，不致命
// - 其它 run-date 的 changes 不参与（只取 --run-date 当天差分）
// - changes 文件缺失 → fail-closed 退出非零
// - 选中条目为 0 → 不产空日报，退出非零
// - 事件文件已存在：无 --force 不碰；--force 重写且与 reports 内容一致
//
// 夹具全走环境变量隔离（GAUBEE_SITE 假站点根 + GAUBEE_SKILLS_DATA 假数据根），
// 全部 id/键名为假值，不触真实仓库与真实数据。

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";

import { localDateOf, type Tweet } from "./lib/x-arch-render.ts";
import { selectDailyEntries } from "./x-daily-events.ts";

const SCRIPT = path.resolve(import.meta.dir, "x-daily-events.ts");

const DATE = "2026-10-07";
const RUN = "2026-10-09";
const OTHER_RUN = "2026-10-08";

// 时间窗夹具用本机构造，保证任何时区下 localDateOf 归日均成立
const insideIso = new Date(`${DATE}T10:00:00`).toISOString(); // 本地 10:00 → 本地日 = DATE
const laterIso = new Date(`${DATE}T11:00:00`).toISOString(); // 本地 11:00 → 同日更晚
const outsideIso = new Date(new Date(`${DATE}T10:00:00`).getTime() + 86_400_000).toISOString(); // 次日
const ancientIso = "2020-01-01T00:00:00.000Z"; // 老推文（差分归属的关键夹具）

function item(id: string, kind: Tweet["kind"], createdAt: string): Tweet {
  return { id, text: `text-${id}`, created_at: createdAt, kind, author: `author_${id}` };
}

// 内存夹具（纯函数用）：覆盖口径的五个条目
const fixtureItems: Record<string, Tweet> = {
  "p-in": item("p-in", "posted", insideIso), // 时间窗内
  "p-out": item("p-out", "posted", outsideIso), // 时间窗外（排除）
  "l-old": item("l-old", "liked", ancientIso), // 老推文，今天赞 → 差分归属
  "l-both": item("l-both", "liked", laterIso), // 既在差分又在时间窗 → 去重
  "l-other": item("l-other", "liked", ancientIso), // 只在其它 run-date 差分里（排除）
  "l-legacy": item("l-legacy", "liked", laterIso), // 基线前存量：无任何 changes 记录 → 回退时间窗
};
const fixtureAdded = [
  { html_url: "https://x.com/whoever/status/l-old", language: "liked" },
  { html_url: "https://x.com/whoever/status/l-both", language: "liked" },
  { html_url: "https://x.com/whoever/status/l-missing", language: "liked" }, // x.json 无此条
];

// 端到端夹具（落盘隔离）：假站点根 + 假数据根
function makeFixture(opts?: { existingEvent?: string }): { root: string; env: Record<string, string> } {
  const root = mkdtempSync(path.join("/tmp", "x-daily-fixture-"));
  const site = path.join(root, "site");
  const eventsDir = path.join(site, "src", "content", "events");
  const sourceDir = path.join(root, "data", "sources", "x-likes");
  const changesDir = path.join(sourceDir, "changes");
  for (const d of [eventsDir, changesDir]) mkdirSync(d, { recursive: true });

  writeFileSync(path.join(sourceDir, "x.json"), JSON.stringify({ items: fixtureItems }) + "\n");
  writeFileSync(
    path.join(changesDir, `${RUN}.json`),
    JSON.stringify({ added: fixtureAdded }) + "\n",
  );
  writeFileSync(
    path.join(changesDir, `${OTHER_RUN}.json`),
    JSON.stringify({ added: [{ html_url: "https://x.com/whoever/status/l-other", language: "liked" }] }) + "\n",
  );
  writeFileSync(path.join(changesDir, "2026-10-02.json"), JSON.stringify({ added: [] }) + "\n");

  if (opts?.existingEvent) {
    writeFileSync(path.join(eventsDir, `07777.x-daily-${DATE}.md`), opts.existingEvent);
  }

  return { root, env: { ...process.env, GAUBEE_SITE: site, GAUBEE_SKILLS_DATA: root } as Record<string, string> };
}

function runGen(env: Record<string, string>, extraArgs: string[] = []): { code: number; stdout: string; stderr: string } {
  const r = Bun.spawnSync(["bun", SCRIPT, ...extraArgs], { env, stdout: "pipe", stderr: "pipe" });
  return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

describe("selectDailyEntries（纯函数，统一口径核心）", () => {
  test("liked 差分归属：老推文今天赞，按 run-date 差分入选（不看 created_at 日）", () => {
    expect(localDateOf(ancientIso)).not.toBe(DATE); // 前提：l-old 的推文日 ≠ 报告日
    const { entries, unresolved } = selectDailyEntries(fixtureItems, fixtureAdded, DATE);
    expect(unresolved).toBe(1);
    expect(entries.map((e) => e.id)).toContain("l-old");
  });

  test("posted 时间窗：窗内入选、窗外排除；其它 run-date 的差分不参与", () => {
    const { entries } = selectDailyEntries(fixtureItems, fixtureAdded, DATE);
    const ids = entries.map((e) => e.id);
    expect(ids).toContain("p-in");
    expect(ids).not.toContain("p-out");
    expect(ids).not.toContain("l-other"); // 只在 OTHER_RUN 的差分里
  });

  test("去重：l-both 既在差分又在时间窗，只出现一次；整体按 created_at 升序", () => {
    const { entries } = selectDailyEntries(fixtureItems, fixtureAdded, DATE);
    const ids = entries.map((e) => e.id);
    expect(ids.filter((id) => id === "l-both").length).toBe(1);
    // 升序：l-old(2020) < p-in(本地10:00) < l-both(本地11:00)
    expect(ids).toEqual(["l-old", "p-in", "l-both"]);
  });

  test("存量回退：无任何 changes 记录的基线前赞，按 created_at 时间窗回退入选", () => {
    // 全量 changes 索引只含三条有记录的 id；l-legacy 不在其中 → 回退
    const all = new Set(["l-old", "l-both", "l-other"]);
    const { entries, fallbackIds } = selectDailyEntries(fixtureItems, fixtureAdded, DATE, all);
    expect(fallbackIds).toEqual(["l-legacy"]);
    const ids = entries.map((e) => e.id);
    expect(ids).toContain("l-legacy");
    // 有 changes 记录的条目不走回退：l-other 只在其它 run-date 差分里，仍排除
    expect(ids).not.toContain("l-other");
    // 有记录且差分命中的 l-old 不因回退重复
    expect(ids.filter((id) => id === "l-old").length).toBe(1);
  });

  test("存量回退关闭（不传全量索引）：行为与旧口径一致，l-legacy 不出现", () => {
    const { entries, fallbackIds } = selectDailyEntries(fixtureItems, fixtureAdded, DATE);
    expect(fallbackIds).toEqual([]);
    expect(entries.map((e) => e.id)).not.toContain("l-legacy");
  });
});

describe("x-daily-events CLI（隔离夹具端到端）", () => {
  test("新日期：只写 reports，不建事件文件；统计行与卡片就位", () => {
    const fx = makeFixture();
    try {
      const r = runGen(fx.env, ["--date", DATE, "--run-date", RUN]);
      expect(r.code).toBe(0);
      const report = path.join(fx.root, "site", "skills", "gaubee-skills", "reports", "daily", `${DATE}-x.md`);
      expect(existsSync(report)).toBe(true);
      const text = readFileSync(report, "utf8");
      expect(text).toContain(`title: "X 日报：${DATE}"`);
      expect(text).toContain("  - event");
      expect(text).toContain("  - signals");
      expect(text).toContain("  - x");
      expect(text).toContain(`<div class="x-arch-meta">4 条动态`);
      expect(text).toContain("https://x.com/author_l-old/status/l-old"); // 差分条目成卡
      expect(text).toContain("author_l-legacy"); // 存量回退条目成卡
      expect(text).not.toContain("author_p-out"); // 窗外排除
      const eventsDir = path.join(fx.root, "site", "src", "content", "events");
      expect(existsSync(path.join(eventsDir, `07777.x-daily-${DATE}.md`))).toBe(false);
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });

  test("事件文件已存在：无 --force 不重写；--force 重写且与 reports 一致", () => {
    const fx = makeFixture({ existingEvent: "---\nold: true\n---\nOLD\n" });
    try {
      const noForce = runGen(fx.env, ["--date", DATE, "--run-date", RUN]);
      expect(noForce.code).toBe(0);
      const ev = path.join(fx.root, "site", "src", "content", "events", `07777.x-daily-${DATE}.md`);
      expect(readFileSync(ev, "utf8")).toBe("---\nold: true\n---\nOLD\n");
      expect(noForce.stderr).toContain("--force");
      const forced = runGen(fx.env, ["--date", DATE, "--run-date", RUN, "--force"]);
      expect(forced.code).toBe(0);
      const evText = readFileSync(ev, "utf8");
      expect(evText).toContain(`title: "X 日报：${DATE}"`);
      const reportText = readFileSync(
        path.join(fx.root, "site", "skills", "gaubee-skills", "reports", "daily", `${DATE}-x.md`),
        "utf8",
      );
      expect(evText).toBe(reportText);
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });

  test("changes 文件缺失：fail-closed 退出非零，不写任何文件", () => {
    const fx = makeFixture();
    try {
      const r = runGen(fx.env, ["--date", DATE, "--run-date", "2026-10-01"]);
      expect(r.code).not.toBe(0);
      expect(r.stderr).toContain("fail-closed");
      expect(existsSync(path.join(fx.root, "site", "skills", "gaubee-skills", "reports", "daily", `${DATE}-x.md`))).toBe(false);
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });

  test("选中条目为 0：不产空日报，退出非零", () => {
    const fx = makeFixture();
    try {
      // 2026-10-01 无 posted 窗内条目；2026-10-02 的 changes added 为空
      const r = runGen(fx.env, ["--date", "2026-10-01", "--run-date", "2026-10-02"]);
      expect(r.code).not.toBe(0);
      expect(r.stderr).toContain("0");
    } finally {
      rmSync(fx.root, { recursive: true, force: true });
    }
  });
});
