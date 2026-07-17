# TODO List

本文件追踪 gaubee.com 的开发任务。

## 历史阶段：Astro 静态博客时期（已完成，代码保留在 git 历史）

旧版本基于 Astro 5 + React，已在 `features/next` 分支提交 `388208c` 处归档。
旧版本完成的功能：三栏式布局、TOC、搜索（minisearch）、标签/归档、管理后台（CodeMirror 编辑器 + schema-driven metadata）、图片 LQIP/PhotoSwipe/响应式、i18n 翻译脚本。

## 当前阶段：Svelte 实时协同编辑器重构（第一阶段：普通模式，已完成）

将站点从静态博客彻底升级为实时协同编辑器。
架构参考 `../jixoai-labs/openspecui` 的 NavController 多区域 tab 内核。

### 阶段 0-8 全部完成 ✅

- [x] **阶段 0：项目初始化** — SvelteKit + shadcn-svelte（luma 主题）+ adapter-static SPA + 业务依赖
- [x] **阶段 1：NavController 内核移植** — 纯 TS reducer + URL 序列化 + 行为插件（43 单元测试）
- [x] **阶段 2：布局组件** — DesktopSidebar/AreaNav 拖拽/MobileHeader+TabBar/BottomArea/PopArea/StatusBar
- [x] **阶段 3：GitHub 认证** — Cloudflare Worker OAuth + API 代理 + session + SettingsView
- [x] **阶段 4：内容数据层** — frontmatter 解析（11 测试）+ contentStore + github client + IndexedDB
- [x] **阶段 5：编辑器子系统** — CodeMirror 6 + Markdown WYSIWYG（494 行）+ MetadataEditor + EditorView（2 browser 测试）
- [x] **阶段 6：预览管线** — marked + Shiki 双主题 + GFM + 截断预览（5 browser 测试）
- [x] **阶段 7：各视图模块** — ArticleView/TagsView/ChangesView/FilesView/ArchiveView/SearchView/GitView
- [x] **阶段 8：打磨与测试** — 暗色模式切换 + 12 个 E2E 测试（10 桌面 + 2 移动）

## 后续阶段（未来规划，第一阶段不做）

### 实时协同（第二阶段）
- [ ] 接入 Yjs/CRDT 或类似方案，实现多人实时协同编辑
- [ ] WebSocket 服务（Cloudflare Durable Objects 或独立服务）
- [ ] 光标/选区共享、在线状态、冲突处理

### i18n 多语言（第三阶段）
- [ ] 英文翻译系统（openspecui 风格增量翻译 + hash 去重）
- [ ] 多语言路由（/en/articles/...）
- [ ] AI 翻译（@google/genai Gemini）

### 功能增强
- [ ] 完整 schema-driven 元数据字段类型系统（text/date/datetime/url/color/object/array 全套）
- [ ] CodeMirror 暗色主题联动
- [ ] 图片上传到 GitHub（编辑器拖拽图片自动上传到 assets/{type}-{id}/）
- [ ] 文章封面图（从正文提取 + AI 搜罗）
- [ ] lit customElements 按需加载（旧 TODO）
- [ ] PWA manifest + service worker
- [ ] 部署配置（Cloudflare Pages + Worker 正式部署 + GitHub OAuth App）

## 不做（明确边界，第一阶段）

- ❌ 实时协同（第一阶段只做普通模式）
- ❌ i18n（只保留中文原稿）
- ❌ streamdown（用 marked + Shiki 替代）
- ❌ AI 封面图生成
