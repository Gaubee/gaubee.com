# event-sync-check — 报告文件与已发布 event 是否一致

## 是什么

`reports/daily/<date>.md` 与 `src/content/events/<序号>.github-daily-<date>.md` 在 publish 之后
就没有自动同步关系了。回补、改数字、补条目时只改一处，站点与档案里就会是两个版本，而且没人会发现。

本工具逐日比对「去掉 frontmatter 后的正文」，列出不一致的日期与首个差异行。

## 解决什么

2026-11-21 回补 11-19 的迟到收藏时，要同时改报告、event 与 11-10 到 11-14 的累计数——
一共 5 个日期、10 个文件。改完用本工具一跑：18 份已发布日报全部一致，只剩 11-20 那份还没发布。
如果没有这道检查，漏改一个 event 也不会有人察觉。

## 怎么跑

```bash
bun tools/2026-11-21-event-sync-check/event-sync-check.ts
bun tools/2026-11-21-event-sync-check/event-sync-check.ts --since 2026-11-01
```

退出码：0 = 全部一致；1 = 有差异；2 = 路径缺失。只读。

## 真实示例输出（2026-11-21）

```text
event-sync-check：从 2026-11-01 起核对 19 份已发布日报

1 处不一致：
  [未发布] 2026-11-20  —
      已写报告但没发布 event
```

发布后复跑即变成 `EVENT SYNC OK：报告与 event 正文一致`。

## 判读建议

- 三类结果：「未发布」（还没发）、「正文不同」（改了一处漏了另一处）、「仅 frontmatter」（可忽略）。
- 正文不同时要判断以哪边为准：通常是报告文件较新（编辑都在那边），把正文同步进 event，编号不动。
- 它只查 GitHub 日报；X 日报的 event 由生成器整份产出，重新生成即可对齐。
