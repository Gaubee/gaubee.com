# deps-jitter-report — deps changes 重复抖动仓识别

## 是什么
回看最近 N 天的 github-deps changes，对每个被 changed[] 点名的仓库做相邻快照对比
（与 deps-digest 同口径，section:name 为键），统计「点名次数 vs 真实版本级变化
次数」；点名 ≥2 次且真实变化为 0 的仓库标为 JITTER 抖动源。只读。

## 解决什么
changes 的 changed[] 口径把清单抖动也算变更：首跑（2026-10-16，7 天窗口）实证
PlusMeta-Admin / net-mesh-simulator / jSouper 三仓**连续 7 天被点名、零版本级
变化**——「依赖变更 N」的 N 有相当部分是确定性噪声。本工具把它定量化，日报/周报
口径可升级为「依赖变更 N（其中 M 为重复抖动）」，也为核心仓（每日重复点名的
BioforestChain 两仓）的 fetcher 侧排查提供名单。

## 怎么跑
```bash
bun tools/2026-10-16-deps-jitter-report/deps-jitter-report.ts [--days 7]
```
退出码：0 = 正常输出；1 = 窗口数据不足。

## 真实示例输出（2026-10-16 实跑）
```
窗口：最近 7 个 changes 日（2026-10-10 ~ 2026-10-16）
JITTER BioforestChain/PlusMeta-Admin：点名 7 次 / 版本级变化 0 次
JITTER BioforestChain/net-mesh-simulator：点名 7 次 / 版本级变化 0 次
JITTER Gaubee/jSouper：点名 7 次 / 版本级变化 0 次

结论：点名 21 次中抖动源 3 个；日报口径可写「依赖变更 N（其中 M 为重复抖动）」
```
