# star-readme — 星标仓库 README 首屏速览

## 是什么

回答「这个 star 到底是干嘛的」：本地 catalog 模糊匹配仓库名 → `gh api` 拉 README → 抽取首段（跳过徽章行、HTML 注释、纯图片、标题与目录），直接可读。已登录 gh 的公开数据读取，零第三方依赖。

## 解决什么

stars-search 能找到仓库名，但「它是干嘛的」还得开浏览器。收藏长尾里大量「当时一键星、现在想不起」的仓库需要一层无需跳转的速览。

## 怎么跑

```bash
bun tools/2026-10-29-star-readme/star-readme.ts mkvgo            # 关键词模糊匹配
bun tools/2026-10-29-star-readme/star-readme.ts jj-vcs/jj        # 精确 owner/repo
```

## 真实示例输出（2026-10-29 首跑）

```text
★ gravity-zero/mkvgo
**Pure-Go media toolkit and streaming packager.** Probe, remux and edit
Matroska/WebM/MP4, then package them for HLS **and** DASH - all in-process, with
no external tools, no cgo and zero dependencies.
One static binary (about 11 MB, or an imported Go library, or a WebAssembly
```

## 边界

- 只抽前几行非装饰文本；README 写得花哨的仓库（大 banner 开头）可能需要多打几个关键词换仓库。
- 多匹配时取第一个并列出其余候选。
