# Change: 事件应用走查修复（2026-10-06 走查轮）

## Why

kzf 于 2026-10-06 实机走查（gaubee.com.localhost）发现 5 个问题；其中 4 个是代码缺陷，
1 个是定时任务运营问题。18 条历史裁决经上轮 self-review 已全部落地（CI aecc976 绿），
本轮在其基线上修复走查增量，并以 OpenSpec 承接后续演进。

## 走查问题清单（kzf 原话归档）

1. 「早上 8 点半还是没有执行。」——cron 未触发（宿主离线），kzf 将自建个人 Agent 接管；
   本轮手动补跑 2026-10-05 的 GitHub 日报与 X 日报。
2. 「event 需要新增一个 title 属性……最近事件有 title 就显示 title。」——报告类 event
   标题格式化（spec R2），widget 当前显示 excerpt 对 x-archive 极不友好。
3. 「原文译文的切换改成 toggleButtonGroup，而不是单个按钮。译文仍然会导致关键换行丢失。」
4. 「在事件详情页，视频控件异常，无法正常使用。」——详情页缺 xvideo/xhighlight action。
5. 「事件列表切换页面滚动量仍然不重置。详情页切换另外一个事件详情，滚动量也存在不重置。」
   ——滚动容器是 AreaOutlet 层容器，此前 window.scrollTo 落空。

## What Changes

- **T1（运营）**：子代理补生成 `reports/daily/2026-10-05.md`（GitHub 日报）与
  `2026-10-05-x.md`（X 日报），publish.ts 发布；媒体单独 📷 提交。cron prompt 同步
  title 格式要求（kzf 自建 Agent 接管前的过渡）。
- **T2（title）**：既有报告 title 规范化为 R2 格式（10-02/03/04）；widget 与事件列表
  头部优先显示 `entry.title`。
- **T3（译文切换）**：生成器改双段 toggle 组（译|原，CSS 高亮当前段，零 JS）；
  旧批次 366 条丢失换行的译文重译（子代理，逐行保真门禁）。
- **T4（详情页）**：ArticleDetailView 补 `use:xvideo`/`use:xhighlight`/
  `data-syntax-theme` + 导入 x-archive.css；浏览器实机走查视频控件。
- **T5（滚动重置）**：新增共享 util `resetScrollFrom(el)`（向上遍历真实滚动祖先）；
  EventView 切月（$effect on currentMonth）与 ArticleDetailView 切篇（$effect on stem）
  统一接入。

## Impact

- 代码：`EventView.svelte`、`ArticleDetailView.svelte`、`RecentEventsWidget.svelte`、
  `x-archive-events.ts`、`x-archive.css`、新增 `src/lib/utils/scroll.ts`；
  内容：1299 个 x-archive 重渲染 + 3 个报告 title + 2 份新日报 + 366 条译文修复。
- Spec：`openspec/specs/event-app/spec.md` 新建（R1-R6 固化历史裁决与本轮增量）。
