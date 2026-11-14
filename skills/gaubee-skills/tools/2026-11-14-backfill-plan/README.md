# backfill-plan — 漏跑补给的「可执行命令清单」

## 是什么

按日期区间输出每一天「该跑什么命令」，并把 X 日报的 `--run-date` 直接算出来：

- 提交 changes 缺失 → `bun scripts/github-commits-fetch.ts <date>`（按报告日命名）；
- GitHub 日报缺失 → 写 `reports/daily/<date>.md` 后 `publish.ts ... --slug github-daily-<date>`；
- X 日报缺失 → `bun scripts/x-daily-events.ts --date <date> --run-date <该日之后第一个 x-likes changes 日期>`，再接 guard。

补齐的日子显示「✓ 已齐全」。

## 解决什么

补跑最费神的不是执行，是两件事：

1. 每个源该按哪个日期命名——commits 按报告日，其余按运行日；
2. X 的 `--run-date` 不能猜。归窗口径是「run-date 的差分归 run-date−1」，猜错会 fail-closed，
   或者把一次跨日差分写进相邻两天（2026-11-14 实证：11-12 与 11-13 各 18 条全同）。

`runDateFor()` 取「>= 报告日的第一个 changes 文件日期」，把补跑变成照抄。

## 怎么跑

```bash
bun tools/2026-11-14-backfill-plan/backfill-plan.ts --from 2026-11-12 --to 2026-11-13
bun tools/2026-11-14-backfill-plan/backfill-plan.ts --from 2026-11-12 --to 2026-11-13 --md
```

退出码：0 = 计划已出（有无缺口都 0）；2 = 参数或目录异常。纯本地只读。

## 真实示例输出

补跑前（2026-11-14）：

```text
补跑计划 2026-11-12 ~ 2026-11-13

2026-11-12（✓ 已齐全）
2026-11-13（3 步）
  bun scripts/github-commits-fetch.ts 2026-11-13
  （写 reports/daily/2026-11-13.md 后）bun scripts/publish.ts reports/daily/2026-11-13.md --slug github-daily-2026-11-13 --title "GitHub 日报：2026-11-13" --tags event,signals,github
  bun scripts/x-daily-events.ts --date 2026-11-13 --run-date 2026-11-14  →  bun tools/2026-11-04-x-daily-guard/x-daily-guard.ts --date 2026-11-13
```

补完后同一区间：

```text
2026-11-12（✓ 已齐全）
2026-11-13（✓ 已齐全）
```

## 判读建议

- 媒体入档与 Graph 重建不在逐日计划里：全区间各跑一次就够，重复跑只会产生空补丁卷。
- 计划里的发布命令是「单条命令」形态，别用 `&&` 串起来——回滚和排错都要单独可重放。
- X 那行给出的 run-date 是差分实际所在的日子。如果那天根本没有 changes（整段没抓过），
  工具会明确写「需先跑 x-likes-fetch」，不会编一个日期出来。
