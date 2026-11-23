/**
 * body-ledger.ts — 工具工坊的体力账本（每天 2 点，跨日不累积）
 *
 * 背景（kzf 2026-11-23 裁决）：产出单位从「每天 2 个工具」改为「每天 2 点体力」，
 * 体力可用于 create / upgrade / delete 三类操作。merge（多合一）、split（一拆多）、
 * rewrite（换实现/换语言）都算 upgrade，各记 1 点——刻意让「减少条目」和「增加条目」
 * 一样便宜，避免工坊无限膨胀（实测 96 个工具里只有 15 个真被用到）。
 *
 * 账本落在私有数据根（不进 git）：`~/.gaubee-skills/tools/body-ledger.json`
 *   { version: 1, days: [{ date, budget, used: [{op, tools, reason, artifacts}], unused }] }
 *
 * 幂等：同日重跑沿用当日已有记录，不重复扣点（补跑场景常见）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const DAILY_BUDGET = 2;

export type LedgerOp = "create" | "upgrade" | "delete";

export interface LedgerEntry {
  op: LedgerOp;
  /** 涉及的工具体（create 用新 id；merge 填多个；delete 填被删的） */
  tools: string[];
  reason: string;
  /** 产物路径（相对 skill 根，如 tools/2026-11-23-foo） */
  artifacts?: string[];
  /** upgrade 的子形态，便于日后统计 */
  mode?: "merge" | "split" | "rewrite" | "patch";
}

export interface LedgerDay {
  date: string;
  budget: number;
  used: LedgerEntry[];
  unused: number;
  /** 该日是否为不限体力模式（迁移/大改专用，需显式标注） */
  unlimited?: boolean;
}

export interface Ledger {
  version: 1;
  days: LedgerDay[];
}

const DATA = process.env.GAUBEE_SKILLS_DATA ?? path.join(os.homedir(), ".gaubee-skills", "data");
export const LEDGER_PATH = path.join(DATA, "..", "tools", "body-ledger.json");

const ymd = (d: Date): string => d.toLocaleDateString("sv-SE");

export function readLedger(): Ledger {
  if (!existsSync(LEDGER_PATH)) return { version: 1, days: [] };
  try {
    return JSON.parse(readFileSync(LEDGER_PATH, "utf8")) as Ledger;
  } catch {
    // 账本损坏时从空开始，但不覆盖原文件（写回前由调用方决定）
    return { version: 1, days: [] };
  }
}

export function dayOf(ledger: Ledger, date = ymd(new Date())): LedgerDay | undefined {
  return ledger.days.find((d) => d.date === date);
}

/** 当日剩余体力（无记录时等于满额） */
export function remainingToday(ledger = readLedger(), date = ymd(new Date())): number {
  const day = dayOf(ledger, date);
  if (!day) return DAILY_BUDGET;
  if (day.unlimited) return Number.POSITIVE_INFINITY;
  return Math.max(0, day.budget - day.used.length);
}

export interface RecordResult {
  ok: boolean;
  ledger: Ledger;
  consumed: number;
  remaining: number;
  error?: string;
}

/**
 * 记录一批操作。整批要么全成功要么全不写（避免超支时只落一半）。
 * `unlimited` 仅用于迁移/大改，需显式传入并在账本留痕。
 */
export function recordOps(
  ops: LedgerEntry[],
  opts: { date?: string; unlimited?: boolean; write?: boolean } = {},
): RecordResult {
  const date = opts.date ?? ymd(new Date());
  const ledger = readLedger();
  const existing = dayOf(ledger, date);
  const budget = existing?.budget ?? (opts.unlimited ? ops.length : DAILY_BUDGET);
  const already = existing?.used.length ?? 0;

  if (!opts.unlimited) {
    if (already + ops.length > budget) {
      return {
        ok: false,
        ledger,
        consumed: already,
        remaining: Math.max(0, budget - already),
        error: `今日体力不足：已用 ${already}/${budget}，本次申请 ${ops.length} 点`,
      };
    }
  }

  const used = [...(existing?.used ?? []), ...ops];
  const day: LedgerDay = {
    date,
    budget: opts.unlimited ? Math.max(budget, used.length) : budget,
    used,
    unused: opts.unlimited ? 0 : Math.max(0, (opts.unlimited ? used.length : budget) - used.length),
    ...(opts.unlimited ? { unlimited: true } : {}),
  };
  const days = existing
    ? ledger.days.map((d) => (d.date === date ? day : d))
    : [...ledger.days, day];

  const next: Ledger = { version: 1, days: days.sort((a, b) => a.date.localeCompare(b.date)) };
  if (opts.write !== false) {
    const dir = path.dirname(LEDGER_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(LEDGER_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  }
  return {
    ok: true,
    ledger: next,
    consumed: used.length,
    remaining: opts.unlimited ? Number.POSITIVE_INFINITY : Math.max(0, day.budget - used.length),
  };
}
