# Spec: event-app（事件应用）

事件应用（app id: `event`）：GitHub 日报 / X 日报 / X 历史归档 / 碎碎念的统一时间线。
详情页复用 articles 的 ArticleDetailView（/article/events/{stem}）。

## Requirements

### R1 数据与路由

- 内容源 `src/content/events/*.md`（frontmatter：`title?`、`date`、`tags`），构建期进只读层。
- 列表路由 `/app/event`（别名 `/app/shout` 兼容旧书签）；详情 `/article/events/{stem}`。
- 日报 event 命名：`github-daily-<date>` / `x-daily-<date>` / 周报 `github-weekly-*` /
  月报 `github-monthly-*` / 年报 `github-yearly-*`；X 历史归档 `x-archive-<date>`。

### R2 事件 frontmatter title（2026-10-06 kzf 裁决）

- 报告类 event（日报/周报/月报/年报）必须带 `title`，格式：
  - GitHub 日报：`GitHub 日报：2026-10-04`（全角冒号）
  - GitHub 周报：`GitHub 周报：2026-09-28～2026-10-04`
  - GitHub 月报：`GitHub 月报：2026-09`；年报：`GitHub 年报：2026`
  - X 日报：`X 日报：2026-10-05`
- 「最近事件」widget 与事件列表头部：有 `title` 显示 `title`，否则回退摘要/slug。

### R3 列表渲染（2026-10-05 裁决 1-4、8、17）

- 按月分页 + 时间轴导航（年+月，仅有数据的月份显示）；桌面左侧粘性导航，移动端浮动按钮+抽屉。
- 条目客观渲染全文 markdown（EventBody），条目头 sticky；列表不渲染头像/名字。
- 切换月份时滚动量重置到顶部。

### R4 X 归档卡片（2026-10-05 裁决 5-16）

- 作者头像外链；原推文新窗口打开；点赞/转发/发布/收藏用有色 icon。
- 推文链接自动包裹可点击；正文客观渲染（含 raw HTML 卡片 x-arch-*）。
- 译文切换：默认显示译文，切换控件为**双段 toggle 组**（译|原，高亮当前段），不占整行。
- 译文保真：换行结构逐行保留；代码块用 microlighter 高亮（`data-syntax-theme="gaubee"`）。
- 图片限制宽高（多图 240px / 单图 360px），点击灯箱展开；挂 width/height/alt。
- 视频挂 width/height/data-duration/poster，播放器 `use:xvideo`（自动播放/单实例/静音记忆/触屏手势）。
- 翻译硬编码在 `skills/gaubee-skills/translations/x-tweets.zh.json`（当前 3025/3025 全覆盖）。

### R5 详情页（ArticleDetailView）

- 详情页与列表同源渲染：`use:xvideo` + `use:xhighlight` + `data-syntax-theme` +
  `x-archive.css`（谁渲染谁导入）。
- 切换到另一篇（上一篇/下一篇/搜索跳转）时滚动量重置。

### R6 滚动容器约束

- gaubeeOS 的滚动容器是 AreaOutlet 的层容器（`.desktop-layer` 等），滚动重置必须
  从内容元素向上遍历真实滚动祖先，不得只 `window.scrollTo`。

## Shutdown

- 报告类 event 的 title 缺失或格式不符时，widget 回退摘要显示（不阻塞渲染）。
