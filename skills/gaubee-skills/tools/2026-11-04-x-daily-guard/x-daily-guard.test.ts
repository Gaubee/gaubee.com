#!/usr/bin/env bun
/**
 * x-daily-guard 回归测试：引用块里的原帖链接不能被算成当窗条目
 *
 * 2026-11-25 实证：11-25 的日报里有一张卡片引用了 11-22 的一条推文，
 * 归窗防线读到 `.x-arch-quote-link` 里的 /status/ 链接，误判成「跨窗重复」，
 * 让 finalize 硬门失败。修复是扫描前先剔掉引用块，本测试锁住这个行为。
 * 规则从主文件导入，避免测试里再抄一份正则导致两边漂移。
 *
 * 跑：bun test tools/2026-11-04-x-daily-guard/x-daily-guard.test.ts
 */
import { describe, expect, test } from "bun:test";

import { collectIds } from "./x-daily-guard.ts";

const ITEM = (id: string) => `<a class="x-arch-link" href="https://x.com/u/status/${id}">原推文</a>`;
const QUOTE = (id: string) =>
  `<div class="x-arch-quote"><div class="x-arch-quote-head"><a class="x-arch-quote-link" href="https://x.com/u/status/${id}">原帖</a></div><div class="x-arch-quote-text">正文</div></div>`;

describe("x-daily-guard 推文 id 提取", () => {
  test("本体链接被识别", () => {
    expect(collectIds(ITEM("2124400758410088841"))).toEqual(["2124400758410088841"]);
  });

  test("引用块里的原帖链接被忽略", () => {
    expect(collectIds(QUOTE("2124400758410088841"))).toEqual([]);
  });

  test("同页既有本体又有引用：只留本体", () => {
    const page = `${ITEM("2125290656692085164")}${QUOTE("2124400758410088841")}`;
    expect(collectIds(page)).toEqual(["2125290656692085164"]);
  });

  test("引用块内的多个链接全部忽略", () => {
    const quote = QUOTE("2124400758410088841").replace(
      "</div><div class=\"x-arch-quote-text\">",
      `<a href="https://x.com/u/status/2125429925054382248">链</a></div><div class="x-arch-quote-text">`,
    );
    expect(collectIds(quote)).toEqual([]);
  });

  test("真跨窗重复仍会被抓到（引用剔除不能放过本体重复）", () => {
    const id = "2124400758410088841";
    const day1 = collectIds(ITEM(id));
    const day2 = collectIds(ITEM(id));
    expect(day1).toEqual(day2);
    expect(day1).toHaveLength(1);
  });

  test("空的引用块不影响后续扫描", () => {
    const page = `<div class="x-arch-quote"><div class="x-arch-quote-head"></div><div class="x-arch-quote-text"></div></div>${ITEM("2125290656692085164")}`;
    expect(collectIds(page)).toEqual(["2125290656692085164"]);
  });
});
