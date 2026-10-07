# event-frontmatter-lint

## 是什么

站点 events 目录（`src/content/events/`，1300+ 文件）frontmatter 的机械校验器。规范锚点：`openspec/specs/event-app/spec.md` R2——报告类 event 的 title 是事件应用「最近事件」widget 的展示键。

## 解决什么

kzf 2026-10-06 裁决了 title 规范（全角冒号：`GitHub 日报：2026-10-04` 等），存量 3 份报告与未来每日发布都可能格式漂移；同时归档正文里 4500+ 处 `/x-media/` 引用需要防断链。人工不可能核对。

## 怎么跑

```sh
bun skills/gaubee-skills/tools/2026-10-07-event-frontmatter-lint/event-frontmatter-lint.ts
```

- 校验项：(a) github-daily-/x-daily-/weekly-/monthly-/yearly- 文件 title 匹配对应 R2 正则；(b) date 可解析且不晚于今天；(c) 报告类 tags 必含 event（**x-archive 归档豁免**——它有自有 x-archive 标签体系，spec 只冻结报告类 title）；(d) 正文 `/cdn-media/<source>/<key>` 引用逐一能在 cdn-media manifest（current.json → manifest-<gen>.json）对象集中找到（2026-10-07 Phase 3 起媒体不在 static/ 磁盘——R1 路径契约，原 static/ 存在性校验随摘除退役）。
- 退出码：0 全过 / 1 有违规。

## 真实示例输出（2026-10-07，1325 event）

```
扫描 1325 个 event；媒体引用 4510 处，断链 0

[OK] 全部校验通过
```
退出码 0。

### 开发注记

首版把「tags 必含 event」施加给全部文件，实测抓出 1299 个 x-archive——复核后确认这是工具规则越界而非数据问题（归档标签体系自有语义），已收窄为报告类专属。工具首跑即校准规则边界，正是它的价值。
