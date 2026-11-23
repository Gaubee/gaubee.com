#!/usr/bin/env bun
/**
 * body-ledger.test.ts — 体力账本的四个关键行为
 *
 * 覆盖：正常扣点、超支拒绝（整批不写）、同日重跑幂等、跨日额度重置。
 * 用临时 GAUBEE_SKILLS_DATA 隔离，不碰真实账本。
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

const ROOT = mkdtempSync(path.join("/tmp", "ledger-fixture-"));
process.env.GAUBEE_SKILLS_DATA = path.join(ROOT, "data");

const { DAILY_BUDGET, LEDGER_PATH, readLedger, recordOps, remainingToday } = await import("./lib/body-ledger.ts");

const op = (tool: string, mode?: "merge" | "split" | "rewrite" | "patch") => ({
  op: "upgrade" as const,
  tools: [tool],
  reason: "测试",
  ...(mode ? { mode } : {}),
});

afterEach(() => {
  rmSync(LEDGER_PATH, { force: true });
});

describe("体力账本", () => {
  test("正常扣点：1 次操作后剩 1 点", () => {
    const r = recordOps([op("a")], { date: "2026-11-23" });
    expect(r.ok).toBe(true);
    expect(r.consumed).toBe(1);
    expect(r.remaining).toBe(1);
    const day = readLedger().days.find((d) => d.date === "2026-11-23")!;
    expect(day.budget).toBe(DAILY_BUDGET);
    expect(day.unused).toBe(1);
  });

  test("超支拒绝：3 个操作整批不写，剩余仍为 2", () => {
    const r = recordOps([op("a"), op("b"), op("c")], { date: "2026-11-24" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("体力不足");
    expect(remainingToday(readLedger(), "2026-11-24")).toBe(2);
  });

  test("同日重跑幂等：第二次不再扣点，也不重复记录", () => {
    recordOps([op("a")], { date: "2026-11-25" });
    const second = recordOps([], { date: "2026-11-25" });
    expect(second.ok).toBe(true);
    expect(second.consumed).toBe(1); // 当日总消耗不变
    const day = readLedger().days.find((d) => d.date === "2026-11-25")!;
    expect(day.used.length).toBe(1);
    const raw = JSON.parse(readFileSync(LEDGER_PATH, "utf8"));
    expect(raw.days.length).toBe(1);
  });

  test("跨日额度重置：新的一天仍是 2 点", () => {
    recordOps([op("a")], { date: "2026-11-26" });
    recordOps([op("a"), op("b")], { date: "2026-11-26" }).ok; // 第二次会超支，忽略
    expect(remainingToday(readLedger(), "2026-11-27")).toBe(DAILY_BUDGET);
  });

  test("合并只记 1 点：merge 形态", () => {
    const r = recordOps(
      [{ op: "upgrade", tools: ["x", "y", "z"], reason: "多合一", mode: "merge" }],
      { date: "2026-11-28" },
    );
    expect(r.ok).toBe(true);
    expect(r.consumed).toBe(1);
    expect(r.remaining).toBe(1);
  });
});
