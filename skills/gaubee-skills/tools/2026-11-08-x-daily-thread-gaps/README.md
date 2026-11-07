# x-daily-thread-gaps — X 日报线程标记缺链审计

## 是什么

按某一天的 X 日报产物逐条反查：正文里带 🧵 或独立 `n/m` 序号、但 `entry.thread` 不足两段的条目，直接点名并给出可复制的 `x-thread-backfill --ids` 命令。

## 解决什么

runbook 有一条线程兜底，此前靠人眼扫报告。2026-11-07 的 hunch 推文结尾就带着 🧵，但当时没有任何信号提示它缺链，差点原样发出去——发现后补抓才发现线程工具本身还有译文污染问题。这个审计把「有没有漏」变成一条命令，并且只按当天报告取条目，不会被库存里大量历史 🧵 误报。

## 怎么跑

```bash
bun tools/2026-11-08-x-daily-thread-gaps/x-daily-thread-gaps.ts --date 2026-11-07
bun tools/2026-11-08-x-daily-thread-gaps/x-daily-thread-gaps.ts --last 7
bun tools/2026-11-08-x-daily-thread-gaps/x-daily-thread-gaps.ts --date 2026-11-07 --strict   # 有缺口退出 1
```

退出码：0 = 报告完成（`--strict` 且有缺口时 1）；2 = 参数/文件异常。纯本地只读。

判定：先剥掉 URL 再找标记（避免 `/status/2115…` 里的数字被当成 `n/m`）；`thread` 至少两段才算成链。

## 真实示例输出（2026-11-08）

当天报告（hunch 已补链）：

```text
2026-11-07-x.md：10 条 · 带线程标记 1 · 缺链 0

合计 1 份日报，缺链 0 条（线程标记全部有链或无需抓链）
```

把该条的 `thread` 临时删掉后复跑（演示检测能力）：

```text
2026-11-07-x.md：10 条 · 带线程标记 1 · 缺链 1
  ✗ 🧵 @mmastrac 2115505657231384683：Meet hunch! Jev-like decisions in ~20ms without even needing…
  修法：bun tools/2026-10-24-x-thread-backfill/x-thread-backfill.ts --ids 2115505657231384683
        抓完重跑 x-daily-events --date <报告日> 重渲染

合计 1 份日报，缺链 1 条
```

## 建议用法

放在 X 日报发布之前跑一次 `--date <报告日>`：有缺口就先抓链再重渲染，别让 🧵 带着半截内容上线。
