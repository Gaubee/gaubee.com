# star-x-cross — 收藏 × X 动态交叉命中

## 是什么

把两套独立数据对上：GitHub 星标（我留下了什么）与 X 动态（我被推送过什么）。
输出两个方向：

1. **收藏 ∩ 动态**：X 正文里提到过的、我收藏过的仓库，带动态条数、最近日期、作者与样例。
2. **动态里出现、尚未收藏**：X 里链接过但没收藏的 GitHub 仓库，作为发现候选。

匹配口径：显式 `github.com/<owner>/<repo>` 链接一律收（`tree/issues` 等子路径截断到两段）；
裸写的 `owner/repo` 只在「该仓库确实在收藏里」时计入方向 1，避免 `and/or`、日期这类误报。

## 解决什么

kzf 常问「我是不是点赞/收藏过一个 X 的东西」。此前只能分别搜 `stars-search` 与
`x-search`，交集要人肉对。本工具把交集直接算出来，顺带回答「这个项目我见过但没收藏」。

## 怎么跑

```bash
bun tools/2026-11-25-star-x-cross/star-x-cross.ts                 # 全量交叉
bun tools/2026-11-25-star-x-cross/star-x-cross.ts docker          # 按关键词过滤
bun tools/2026-11-25-star-x-cross/star-x-cross.ts --days 90       # 只看最近 90 天的动态
bun tools/2026-11-25-star-x-cross/star-x-cross.ts --json          # 管道输出
```

## 真实示例输出（2026-11-25 首跑）

```text
$ bun tools/2026-11-25-star-x-cross/star-x-cross.ts
star-x-cross：收藏 1825 · X 3573 条动态
收藏 ∩ 动态：78 个仓库在 X 里被提过，共 137 条动态

  longbridge/nsh  ★3379 Rust — 12 条（最近 2026-11-20 · @huacnlee、@vikingmute）
      Native Shell is a native UI framework for iOS, Android, macOS, Windows, Linux and the web, built in
      样例：这个是 NSH 里面的 Plot 组件实现的 Chart 应用。由于现在 NSH 能具备更好的多平台动画能力…
  oven-sh/bun  ★96921 Rust — 5 条（最近 2026-10-27 · @jarredsumner、@bunjavascript）
  …

动态里出现、尚未收藏：172 个
  microsoft/typescript — 5 条（最近 2022-12-13 · @AndaristRake、@sebastienlorber）
  vitejs/vite — 4 条（最近 2026-07-30 · @vite_js、@evanyou）
  …
```

```text
$ bun tools/2026-11-25-star-x-cross/star-x-cross.ts docker
star-x-cross：收藏 1825 · X 3573 条动态 · 过滤「docker」
收藏 ∩ 动态：2 个仓库在 X 里被提过，共 2 条动态

  rustrak/rustrak  ★1850 Rust — 1 条（最近 2026-10-15 · @konghayao）
  unilei/kerkerker  ★679 TypeScript — 1 条（最近 2025-12-07 · @liangwenhao3）

动态里出现、尚未收藏：0 个
```

## 判读

- 方向 1 的高频项集中在 NSH / bun / mattpocock-skills，和日报里的 X 主题一致，说明交叉口径没有乱配。
- 方向 2 的候选里混有大仓库（typescript、vite），这是「见过但有意不收藏」的正常结果，不是漏收藏。
- 网页版只读站点公开投影（X 投影 1500 条近期动态）；CLI 读本地全量 3573 条，两边数字会不同。
- 形态：**webapp**，数据 `static/tools/data/stars.json` + `x.json`，浏览器里可跑。
