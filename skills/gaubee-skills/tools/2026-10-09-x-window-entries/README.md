# x-window-entries

## 是什么

X 日报的窗口条目选择器：把「T-1 报告日」应收录的 x.json 条目一条命令列成可写进日报的
清单（id/kind/作者/时间/链接/正文摘要/媒体引用），并逐个媒体对账 cdn-media manifest，
标注在卷或缺卷。

## 归窗规则（kzf 2026-10-09 裁决，方案 a）

- **liked/bookmarked → 抓取差分**：X 不暴露点赞时刻（x.json 的 created_at 是推文发布
  时间，雪花 ID 可证），按「本次抓取 run 的 changes added」归窗——东八区 8:30 日更节奏
  下，运行日的 changes added 恰是昨天点的赞。读 `--run-date`（默认今天）的
  `changes/<run-date>.json`，按 html_url 里的 status id 回查 x.json 全量字段。
- **posted/reposted → 推文时间窗**：发推/转发的行为时间=推文发布时间，按本地日窗过滤。
- `--attribution auto`（默认）= 两类各用各的口径合并去重；`tweet`/`fetch` 单口径供诊断。

## 解决什么

2026-10-08 实证：一条 10-08 白天点的赞、对象是 10-07 晚发布的推文，被推文时间窗切进
已发布的 10-07 报告，永远收不到。方案 a 后按抓取差分归窗，行为日=收录日，无漏收。

## 怎么跑

```sh
bun ~/.agents/skills/gaubee-skills/tools/2026-10-09-x-window-entries/x-window-entries.ts
bun ~/.agents/skills/gaubee-skills/tools/2026-10-09-x-window-entries/x-window-entries.ts --date 2026-10-08
bun ~/.agents/skills/gaubee-skills/tools/2026-10-09-x-window-entries/x-window-entries.ts --attribution fetch --run-date 2026-10-09
bun ~/.agents/skills/gaubee-skills/tools/2026-10-09-x-window-entries/x-window-entries.ts --json
```

路径覆盖：`X_JSON`、`X_CHANGES_DIR`；manifest 对账读仓库 cdn-media/manifest/current.json。
退出码：成功 0；changes 缺失（fetch 口径）1；参数错误 2。

## 真实示例输出（2026-10-09 实跑 --date 2026-10-08 --attribution auto）

```
x-window-entries：2026-10-08（归窗 auto；tweet 窗口 UTC 2026-10-07T16:00 ~ 2026-10-08T16:00）
条目 5 条

[liked] 12:00 local @silvanrec（fetch-diff）  https://x.com/silvanrec/status/2107803133233471626
  🚨 刚刚泄露了一个用 AI 打造的翻译器，它完胜所有对手，而且完全免费 这是腾讯做的…
[liked] 19:07 local @argyleink（fetch-diff）  https://x.com/argyleink/status/2107910755194634376
  这里使用 #CSS 滚动捕捉来实现手势驱动的底部面板，这项工作非常酷
[liked] 00:05 local @naaiyy_（fetch-diff）    https://x.com/naaiyy_/status/2107985803301281882
  Liquid Glass，适用于网页。开源。…
[liked] 04:16 local @zhongerxin（fetch-diff） https://x.com/zhongerxin/status/2108048762245697935
  iPhone Use - 我这两天在做的一个插件，让 Codex 可以直接操作你自己的手机。…
[liked] 16:04 local @devongovett（fetch-diff） https://x.com/devongovett/status/2108227127103656441
  📢 介绍 React Aria Sheet 组件！ ‣ 原生滑动手势，由 CSS 滚动吸附技术驱动 …
```

注：当日已发布的 01816 报告收录了其中 3 条（旧推文时间窗口径），silvanrec 与
devongovett 两条是今天抓取才入账的——方案 a 下此类「迟到期」不再发生。
