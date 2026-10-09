# x-window-entries

## 是什么

X 日报的窗口条目选择器：把「T-1 本地日窗」的 x.json 条目一条命令列成可写进日报的
清单（id/kind/作者/本地时间/链接/正文摘要/媒体引用），并逐个媒体对账 cdn-media
manifest，标注在卷或缺卷。

## 解决什么

x.json 的 created_at 是 UTC ISO 串，日报要的是本地日窗（如 10-08 = UTC
10-07T16:00 起 24h），此前每天由 agent 手写 python 过滤，媒体还要另跑对账。2026-10-09
实跑与本管道当日人工筛选逐条一致（3/3）；另用它发现 10-07 窗口存在 1 条迟到期条目
（点赞发生在昨报发布之后），证实「fetch-then-report」存在竞态窗口。

## 怎么跑

```sh
bun ~/.agents/skills/gaubee-skills/tools/2026-10-09-x-window-entries/x-window-entries.ts                  # 昨天窗口
bun ~/.agents/skills/gaubee-skills/tools/2026-10-09-x-window-entries/x-window-entries.ts --date 2026-10-08
bun ~/.agents/skills/gaubee-skills/tools/2026-10-09-x-window-entries/x-window-entries.ts --json
```

路径覆盖：`X_JSON`（默认 ~/.gaubee-skills/data/sources/x-likes/x.json）；manifest 对账
读仓库 cdn-media/manifest/current.json。退出码：成功 0；日期格式错误 2。

## 真实示例输出（2026-10-09 实跑 --date 2026-10-08）

```
x-window-entries：2026-10-08（本地日窗，UTC 2026-10-07T16:00 ~ 2026-10-08T16:00）
条目 3 条

[liked] 19:07 local @argyleink  https://x.com/argyleink/status/2107910755194634376
  这里使用 #CSS 滚动捕捉来实现手势驱动的底部面板，这项工作非常酷

[liked] 00:05 local @naaiyy_  https://x.com/naaiyy_/status/2107985803301281882
  Liquid Glass，适用于网页。开源。 Apple 的 Liquid Glass 外观，适用于任何地方：…

[liked] 04:16 local @zhongerxin  https://x.com/zhongerxin/status/2108048762245697935
  iPhone Use - 我这两天在做的一个插件，让 Codex 可以直接操作你自己的手机。 …
```

媒体条目会附 `media: /cdn-media/x/… 在卷 ✓`（或 `缺卷 ✗（先 media-pack --patch）`）。
