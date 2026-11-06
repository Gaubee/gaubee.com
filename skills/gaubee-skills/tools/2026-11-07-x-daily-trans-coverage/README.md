# x-daily-trans-coverage — X 日报译文覆盖率审计

## 是什么

拿渲染好的 X 日报反查每一条动态：正文是什么语言、有没有译文。把「非中文但没译文」的条目点名，附作者与正文开头，指明补译入口。

## 解决什么

译文增量管道按「非中文正文」挑条目，但它的中文判定把假名一起算成中文，于是日文推文整条漏译。2026-11-06 日报里 @clockmaker 那条 Chrome 157 的 HTML-in-Canvas 公告就是这样裸着假名上了站；补译之后本工具复跑归零。英文侧也有盲区：正文很短、夹在链接里的英文，光看导出列表不一定察觉。

## 怎么跑

```bash
bun tools/2026-11-07-x-daily-trans-coverage/x-daily-trans-coverage.ts --date 2026-11-06
bun tools/2026-11-07-x-daily-trans-coverage/x-daily-trans-coverage.ts --last 5
bun tools/2026-11-07-x-daily-trans-coverage/x-daily-trans-coverage.ts --last 30 --strict   # 有缺口退出 1
```

退出码：0 报告完成；`--strict` 且有缺口时 1；2 参数或文件异常。纯本地只读。

语言判定顺序：假名 → 日；谚文 → 韩；去掉 URL 与裸域名后看汉字与拉丁词比例 → 中/英；纯链接标记为「链接」不要求翻译。这样带域名尾巴的中文（如「新版 MyGo 音乐已上线 music.egoist.dev」）不会被误判成英文。

## 真实示例输出

首跑（2026-11-06，补译前）：

```text
2026-11-06-x.md：18 条 · 有译文 8 · 缺口 1
  语言分布：中 9 / 链接 1 / 英 7 / 日 1
  ✗ 日 @clockmaker：Chrome 157がリリースされ、待望の「HTML-in-Canvas」が正式搭載されました。 HTML・CSSのレイアウトを…
  修法：bun scripts/x-translations-export.ts 手补该条译文后重渲染该日日报
```

补译该条并重渲染后：

```text
2026-11-06-x.md：18 条 · 有译文 9 · 缺口 0
  语言分布：中 9 / 链接 1 / 英 7 / 日 1
```

跨最近三份日报复跑：`合计 3 份日报，缺口 0 条（全部有译文）`。

## 建议用法

放在 X 日报发布之前跑一次 `--date <报告日>`：缺口非零就先补译再重渲染，别等站上读者看到假名。
