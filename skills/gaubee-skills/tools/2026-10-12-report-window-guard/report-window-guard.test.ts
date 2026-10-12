// report-window-guard.test.ts — build-report.ts 窗口口径回归守卫（工坊 2026-10-12）
//
// 动机（2026-10-12 实证）：cron 周一早晨生成周报，--weekly 此前取「本周一 ~ 今天」，
// 刚开始的本周只剩当天——W42 骨架仅 3 行数据。修复为「上一个完整周」后，本测试把
// 窗口口径与 ISO 年边界钉死，防止回归。跑法：bun test tools/2026-10-12-report-window-guard/
import { describe, expect, test } from "bun:test";

import {
  hasRealAnalysis,
  preserveAnalysis,
  weeklyWindow,
} from "../../scripts/build-report.ts";

describe("weeklyWindow（上一个完整周）", () => {
  test("周一早晨生成：窗口 = 上一个完整周（2026-W41 回归锚点）", () => {
    const w = weeklyWindow(new Date(2026, 9, 12)); // 2026-10-12 周一
    expect(`${w.from}~${w.to}`).toBe("2026-10-05~2026-10-11");
    expect(`${w.year}-W${String(w.week).padStart(2, "0")}`).toBe("2026-W41");
  });

  test("周内其余各天：窗口恒为上一个完整周（修复前此处返回「当天~当天」）", () => {
    for (const d of [13, 14, 15, 16, 17]) {
      const w = weeklyWindow(new Date(2026, 9, d));
      expect(`${w.from}~${w.to}`).toBe("2026-10-05~2026-10-11");
    }
  });

  test("周日：仍以本周一为锚取前一周（报告固定周一生成，语义恒定）", () => {
    const w = weeklyWindow(new Date(2026, 9, 11)); // 2026-10-11 周日
    expect(`${w.from}~${w.to}`).toBe("2026-09-28~2026-10-04");
  });

  test("ISO 年边界：W52 → 跨年 W53 的标签与窗口", () => {
    const a = weeklyWindow(new Date(2026, 11, 28)); // 2026-12-28 周一 → 上周是 W52
    expect(`${a.year}-W${String(a.week).padStart(2, "0")}`).toBe("2026-W52");
    expect(`${a.from}~${a.to}`).toBe("2026-12-21~2026-12-27");
    const b = weeklyWindow(new Date(2027, 0, 4)); // 2027-01-04 周一 → 上周跨年，属 2026-W53
    expect(`${b.year}-W${String(b.week).padStart(2, "0")}`).toBe("2026-W53");
    expect(`${b.from}~${b.to}`).toBe("2026-12-28~2027-01-03");
  });
});

describe("分析段保留（整文件覆写防线）", () => {
  const placeholder = "## 分析（agent 补充）\n\n<!-- 主题聚类、品味画像印证 -->\n";

  test("hasRealAnalysis：占位注释不算内容，正文算", () => {
    expect(hasRealAnalysis(placeholder)).toBe(false);
    expect(hasRealAnalysis("## 分析（agent 补充）\n\n### 主题聚类\n\n正文结论。\n")).toBe(true);
  });

  test("preserveAnalysis：骨架重生成时保留 agent 已写的分析", () => {
    const prev = "# 旧骨架\n\n" + "## 分析（agent 补充）\n\n### 主题聚类\n\n我的分析正文。\n";
    const next = "# 新骨架（27 change files）\n\n" + placeholder;
    const merged = preserveAnalysis(prev, next);
    expect(merged).toContain("新骨架");
    expect(merged).toContain("我的分析正文。");
  });

  test("preserveAnalysis：占位态不保留（骨架正常刷新）", () => {
    const prev = "# 旧\n\n" + placeholder;
    const next = "# 新\n\n" + placeholder;
    expect(preserveAnalysis(prev, next)).toBe(next);
  });
});
