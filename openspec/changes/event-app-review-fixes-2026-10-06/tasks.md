# Tasks: event-app-review-fixes-2026-10-06

## T1 报告补跑（运营）

- [x] 子代理生成 `reports/daily/2026-10-05.md`（GitHub 日报，tone gate RED 清零）
- [x] 子代理生成 `reports/daily/2026-10-05-x.md`（X 日报，条目化 + 站内媒体）
- [x] 主线程核验后 publish.ts 发布（slug `github-daily-2026-10-05` / `x-daily-2026-10-05`）
- [x] 新媒体文件 📷 单独提交
- [x] cron automation prompt 追加 title 格式要求

## T2 title 规范化与展示

- [x] 既有报告（10-02/03/04）title 改 R2 格式（`GitHub 日报：2026-10-04`）
- [x] `RecentEventsWidget.svelte`：`p.title` 优先，空则回退摘要
- [x] `EventView.svelte`：`titleFor` 改用 `entry.title`（原 `metadata.title` 恒空）

## T3 译文切换与换行保真

- [x] 生成器：toggle 改双段组（label 内 译|原 两段，CSS 高亮当前段）
- [x] `x-archive.css`：双段组样式（x-arch-lang-* 重写，自持不进全局）
- [x] 旧批次 366 条译文重译（src-11 批，newline-lost 0 门禁）→ 合并
- [x] 重跑生成器全量重渲染 → build 验证

## T4 详情页渲染对齐

- [x] `ArticleDetailView.svelte`：导入 x-archive.css + use:xvideo + use:xhighlight +
  `data-syntax-theme="gaubee"` 挂 article 元素
- [x] 实机走查：详情页视频可播放、高亮生效、无样式污染

## T5 滚动重置

- [x] 新增 `src/lib/utils/scroll.ts`：`resetScrollFrom(el)` 遍历真实滚动祖先置顶
- [x] `EventView.svelte`：`$effect` 监听 currentMonth 变化调用（替换失效的 window.scrollTo）
- [x] `ArticleDetailView.svelte`：`$effect` 监听 stem 变化调用
- [x] 实机走查：切月/切篇滚动归零

## 验证门

- [x] `pnpm build` exit 0
- [x] 生成产物抽验：双段 toggle 结构、译文换行 <br />、视频属性
- [x] 提交推送 → CI 绿
