# star-cumulative-attribution — 星标累计漂移的「归因」而不是「报错」

## 是什么

`report-lint` 会告诉你「这 23 份日报的星标总数对不上、各差多少」，但不告诉你为什么。
本工具按日给出归因：

| 归因 | 含义 |
| --- | --- |
| `rename`（当日） | 那天发生了仓库改名，changes 里多出一条 added（新名），但当天的日报把它当「新增」算进了累计 |
| `rename`（传导） | 当日本身无改名，误差来自更早某次改名的遗留 |
| `revision` | 某仓库的 `starred_at` 被上游改写，历史累计整体平移 |
| `unknown` | 两者都解释不了 —— **这才是需要人看一眼的** |

## 解决什么

2026-11-16 的实例：`report-lint` 一次报出 23 份日报对不上，全部差 1，从 10-24 起恒为 1、11-03 起变 2。
逐条查下去，根因不是算术错：

- **10-24 的改名**：`alshdavid-public/BorrowScript → alshdavid-misc/BorrowScript`。changes 里是
  「removed 旧名 + added 新名」，当时的日报把 added 那条算进了累计 —— 但它不是新收藏。
  这条误差从 10-24 起一路带到 11-14。
- **cicada 的修订**：`wquguru/cicada` 的 `starred_at` 被上游从 11-03 改到 11-08，导致
  11-03 到 11-07 的累计各少 1，所以那几天差 2。

本工具首跑：23 份全部归因成功，0 个 unknown。结论是这些是历史事实、不是算术错误，
不必改历史日报。

## 归因规则（两次修正后定稿）

第一版把所有「早于该日的改名」都列成归因，导致 10-23 的报告被归因到 10-24 的改名——
时间上不可能。正确规则是：

1. 改名当天，changes 会多一条 added（新名），正是这条被误算进累计；
2. 只有 `date == 改名日` 的日报会被直接影响；
3. 之后的日子是这条误差的**传导**，要单独标注，不能混作直接原因。

## 怎么跑

```bash
bun tools/2026-11-16-star-cumulative-attribution/star-cumulative-attribution.ts
bun tools/2026-11-16-star-cumulative-attribution/star-cumulative-attribution.ts --date 2026-11-03
```

退出码：0 = 全部漂移都有归因；1 = 存在无法归因的漂移（需要人看）；2 = 数据缺失。纯本地只读。

## 真实示例输出（2026-11-16 首跑）

```text
星标累计漂移归因（23 份日报对不上）

2026-10-23  写 1710，实测 1709（差 +1）  归因：rename
  · [rename] 传导：2026-10-17 的改名把 +1 带到了此后所有日报（当日本身无改名）

2026-10-24  写 1711，实测 1710（差 +1）  归因：rename
  · [rename] 2026-10-24 改名：alshdavid-public/BorrowScript → alshdavid-misc/BorrowScript

2026-11-03  写 1748，实测 1746（差 +2）  归因：revision
  · [revision] wquguru/cicada starred_at 2026-11-03 → 2026-11-08

全部 23 份都有归因：改名会让当日多算 1（added 的新名被当新增），
starred_at 修订会让后续累计整体平移。这些是历史事实，不是算术错误，不必改历史日报。
```

## 判读建议

- 出现 `unknown` 才需要动手查：那表示某天的累计错法用改名和修订都解释不了，可能是真的算错。
- 归因成立时**不要改历史日报**——报告在当时是对的（按当时的数据），改历史会让归档失真。
- 这个工具配合 `report-lint` 用：lint 负责发现（门禁），本工具负责定性（归因）。
