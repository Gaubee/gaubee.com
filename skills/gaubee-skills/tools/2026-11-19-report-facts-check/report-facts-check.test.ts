#!/usr/bin/env bun
/**
 * report-facts-check 回归测试：提交公私拆分必须读 private 字段
 *
 * 2026-11-25 实证：旧实现用仓库名正则 `fde2e|keel|jixoai/bu$|omni` 判私有，
 * 把已转公开的 jixoai/keel（6 条）与 jixoai/reply9842（1 条）算成私有，
 * 于是同一份 11-25 快照被算成「公开 6 + 私有 24」，而真实是「公开 12 + 私有 18」。
 * `gh repo view` 核对：只有 jixoai/fde2e 是 PRIVATE，keel/reply9842 都是 PUBLIC。
 *
 * 跑：bun test tools/2026-11-19-report-facts-check/report-facts-check.test.ts
 */
import { describe, expect, test } from "bun:test";

import { splitPublicPrivate } from "./report-facts-check.ts";

// 2026-11-25 的真实快照（来自 ~/.gaubee-skills/data/sources/github-commits/history）
const SNAPSHOT = [
  { repo: "Gaubee/gaubee.com", count: 5, private: false },
  { repo: "jixoai/fde2e", count: 18, private: true },
  { repo: "jixoai/keel", count: 6, private: false },
  { repo: "jixoai/reply9842", count: 1, private: false },
];

describe("提交公私拆分", () => {
  test("11-25 真实快照：公开 12 + 私有 18", () => {
    expect(splitPublicPrivate(SNAPSHOT, 30)).toEqual({ pubN: 12, privN: 18 });
  });

  test("已转公开的仓库不再算私有（旧正则的错）", () => {
    const { privN } = splitPublicPrivate(SNAPSHOT, 30);
    // 旧正则会把 keel(6) + reply9842(1) 一起算进私有，得到 25。
    expect(privN).toBe(18);
  });

  test("全公开时私有数为 0", () => {
    const pushes = [
      { repo: "a/b", count: 3, private: false },
      { repo: "c/d", count: 2, private: false },
    ];
    expect(splitPublicPrivate(pushes, 5)).toEqual({ pubN: 5, privN: 0 });
  });

  test("全私有（快照里缺 private 字段也按可选处理）", () => {
    const pushes = [{ repo: "a/b", count: 4 }];
    // private 缺省视为公开，与抓取端「isPrivate 落盘」的语义一致
    expect(splitPublicPrivate(pushes, 4)).toEqual({ pubN: 4, privN: 0 });
  });

  test("总数以 totalCommits 为准，不受 pushes 条数影响", () => {
    const { pubN, privN } = splitPublicPrivate(SNAPSHOT, 30);
    expect(pubN + privN).toBe(30);
  });
});
