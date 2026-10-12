# report-window-guard — build-report 窗口口径回归守卫

## 是什么
`bun test` 测试套件，把 `scripts/build-report.ts --weekly` 的窗口口径（上一个完整周，
周一~周日）和 ISO 年边界（W52→跨年 W53）钉死；同时覆盖同日加入的「分析段保留」防线
（`preserveAnalysis`：骨架重生成时不冲掉 agent 已写的分析段）。

## 解决什么
2026-10-12 实证两起：
1. cron 周一早晨生成周报，`--weekly` 此前取「本周一 ~ 今天」——刚开始的本周只剩当天，
   W42 骨架仅 3 行数据、0 个上周事实。已修复为 `weeklyWindow()`（上一个完整周）。
2. 修复后重跑 `--weekly` 整文件覆写，把已补充的分析段冲掉。已修复为
   `preserveAnalysis()`（重生成时拼接回已写分析）。

两条修复都只改了行为、没有守卫——本测试防止下次重构把窗口口径或保留防线悄悄改回去。

## 怎么跑
```bash
bun test tools/2026-10-12-report-window-guard/
```
被测函数从 `scripts/build-report.ts` 具名导入（该文件已加 `import.meta.main` 守卫，
import 不再触发 main/写文件）。

## 真实示例输出（2026-10-12 实跑）
```
7 pass
0 fail
17 expect() calls
```

## 状态
proposed。守卫价值即时生效（每周一生成周报前跑一次即可）；若 build-report 未来进入
CI 常规测试面，可把本文件迁为 `scripts/build-report.test.ts`。
