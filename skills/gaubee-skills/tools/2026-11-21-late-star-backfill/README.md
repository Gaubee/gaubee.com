# late-star-backfill — 找出「迟到的收藏」并给出回补清单

## 是什么

收藏的 `starred_at` 可能早于它第一次出现在 `changes` 里的日期。日报按 `starred_at` 归属，
所以这类条目属于**更早那天**，不回补就会让此后每一天的累计都差上这个数。

本工具按日列出：迟到条目、当日实际新增、当日实际累计、要改哪两个文件、回补要点。

## 解决什么

2026-11-21 实证：`Veloresearch/kinetic` 与 `MoeForge/moego` 的 `starred_at` 都是 11-19，
直到 11-21 的抓取才第一次出现。于是 11-19 的日报写「新增 6（1805）」，真实是「8（1807）」。
不作处理的话，后面每一天的累计都会少 2。

首跑还把 11-13 的另一处翻出来：`opencoredev/islandcn` 同样迟到（11-13 收藏、11-15 才出现），
那天的日报只写了 h3-image-mlx。两处都已回补，`report-facts-check` 复核全绿。

## 判据

正常应在「收藏日 + 1」的 changes 里出现（抓取次日报昨日）。晚于次日即迟到。
`starred_at` 相同但 owner 变了的不算（那是改名，另有工具）。

## 怎么跑

```bash
bun tools/2026-11-21-late-star-backfill/late-star-backfill.ts
bun tools/2026-11-21-late-star-backfill/late-star-backfill.ts --days 14
```

退出码：0 = 已输出；2 = 数据缺失。只读，不改文件（回补要加条目、改累计、顺行文，属编辑工作）。

## 真实示例输出（2026-11-21）

```text
近 14 天发现 2 天有迟到的收藏：

2026-11-13：迟到 1 条，当日实际新增 2，累计 1787
  + opencoredev/islandcn（2026-11-15 才出现）
  报告：在（reports/daily/2026-11-13.md）
  已发布 event：01908.github-daily-2026-11-13.md（编号冻结，改内容用同文件原地重写）
  回补要点：加条目 + 把「新增 N（总数 M）」改成 2 / 1787
```

## 判读建议

- 回补要**同时**改报告与已发布 event（编号不动、原地重写），改完跑 `event-sync-check` 与
  `report-facts-check <date>` 两道复核。
- 若同一天有多条迟到，累计只加一次总数，别逐条叠加。
- 与 `star-cumulative-attribution` 分工：那个解释「为什么对不上」，这个给出「怎么补」。
