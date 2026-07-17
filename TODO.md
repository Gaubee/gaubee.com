# TODO List

本文件追踪 gaubee.com 的开发任务。

## 历史阶段：Astro 静态博客时期（已完成，代码保留在 git 历史）

旧版本基于 Astro 5 + React，已在 `features/next` 分支提交 `388208c` 处归档。
旧版本完成的功能：三栏式布局、TOC、搜索（minisearch）、标签/归档、管理后台（CodeMirror 编辑器 + schema-driven metadata）、图片 LQIP/PhotoSwipe/响应式、i18n 翻译脚本。

## 当前阶段：Svelte 实时协同编辑器重构

将站点从静态博客彻底升级为实时协同编辑器（第一阶段：普通模式，无协同）。
架构参考 `../jixoai-labs/openspecui` 的 NavController 多区域 tab 内核。

### 阶段 0：项目初始化 ✅

- [x] 备份验证 git 历史，确认数据资源完整（60 articles + 21 events + assets + draft）
- [x] 清空旧 Astro 文件，保留 `src/content/`、`static/assets/`、`draft/`
- [x] SvelteKit 初始化（`sv create`：minimal + ts + tailwindcss + vitest + playwright + mdsvex + adapter-static）
- [x] shadcn-svelte 风格化（preset `b7AJHA9Tr0`，luma 主题 + IBM Plex Sans）
- [x] SPA 模式配置（`ssr=false` + `prerender=true` + `fallback: 'index.html'`）
- [x] 业务依赖安装（CodeMirror 6 全套、marked、shiki、octokit、idb、minisearch、mode-watcher、svelte-sonner）
- [x] 基础 shadcn 组件（button/card/dialog/sheet/tabs/tooltip/dropdown-menu 等 19 个）
- [x] 类型检查 + 构建通过

### 阶段 1：NavController 内核移植（进行中）

> 框架无关的纯 TS 内核，编辑器骨架的心脏。

- [ ] `src/lib/nav/controller.ts`：reducer + URL 序列化 + 行为插件
  - [ ] 类型定义（TabId / Area / KernelState / KernelEvent / KernelTransition）
  - [ ] 重定义 TabId 为本项目路由（feed/article/editor/files/changes/tags/archive/settings + git/preview-server + search/notifications）
  - [ ] reduceKernel 纯函数（所有 case）
  - [ ] parseBrowserLocation / buildCanonicalUrl（main→path, bottom→`?_b=`, pop→`?_p=`）
  - [ ] applyBehaviorPlugins（carryActiveOnMove + ensureMainHasActive）
  - [ ] sanitize/merge 工具
  - [ ] localStorage 持久化（去掉远端 KV）
- [ ] `src/lib/nav/nav-items.ts`：nav 项元数据（icon 用 @lucide/svelte，中文 label）
- [ ] `src/lib/nav/area.svelte.ts`：Svelte 5 runes adapter（subscribe + snapshot 缓存）
- [ ] `src/lib/nav/area-outlet.svelte`：区域出口（按 area location 渲染对应 view，组件保活）
- [ ] `src/routes/+layout.svelte`：根布局（挂载 NavController，渲染四区）
- [ ] `src/app.css`：容器查询布局 CSS（移植 openspecui index.css）
- [ ] `src/lib/nav/controller.test.ts`：vitest 单元测试（reducer 每个 case + URL 序列化往返）

### 阶段 2：布局组件（移动优先）

- [ ] `DesktopSidebar.svelte`：两个 AreaNav（main/bottom）+ 折叠态
- [ ] `AreaNav.svelte`：tab 列表 + HTML5 拖拽 + 落点指示线
- [ ] `MobileHeader.svelte` + `MobileTabBar.svelte`：移动端顶栏与底栏
- [ ] `BottomAreaRouter.svelte`：bottom 区 + ResizeHandle 拖拽改高度
- [ ] `PopAreaRouter.svelte`：pop 区，渲染为 Dialog
- [ ] `StatusBar.svelte`：底部状态栏（登录态、commit 状态、当前文件路径）
- [ ] 移动端 Playwright 测试（iPhone 14 Pro / Pixel 7 viewport）

### 阶段 3：GitHub 认证

- [ ] `worker/`：Cloudflare Worker（OAuth 回调）
  - [ ] `GET /auth/github`：重定向到 GitHub authorize URL（带 state 防 CSRF）
  - [ ] `GET /auth/github/callback`：code 换 token，设 httpOnly cookie，重定向回应用
  - [ ] `POST /auth/logout`：清 cookie
  - [ ] `GET /auth/me`：返回用户信息
  - [ ] `GET /api/proxy/*`：用 cookie token 代理 GitHub API（避免前端暴露 token）
- [ ] `src/lib/auth/session.svelte.ts`：前端 session 管理（runes）
- [ ] `src/lib/views/settings/SettingsView.svelte`：登录/登出按钮 + 用户信息
- [ ] 部署文档（wrangler.toml + GitHub OAuth App 配置说明）

### 阶段 4：内容数据层 + 迁移

- [ ] `src/lib/data/content.svelte.ts`：octokit 拉内容 + 客户端解析 frontmatter + IndexedDB 缓存
- [ ] `src/lib/data/frontmatter.ts`：frontmatter 解析/序列化（保留 `__editor_metadata` 透传）
- [ ] `src/lib/github/client.ts`：octokit 封装（getFileContent/getRepoContents/commitChanges）
- [ ] 迁移脚本：清掉旧 `preview`/`previewHTML` 字段（让新管线重建）

### 阶段 5：编辑器子系统

- [ ] `CodeMirror.svelte`：CM6 Svelte 5 封装（$effect 生命周期 + 避免反馈循环）
- [ ] `markdown-wysiwyg.ts`：移植 codemirror-markdown-preview.ts（隐藏语法标记 + WidgetType）
- [ ] `MetadataEditor.svelte`：frontmatter 表单（移植字段类型系统）
- [ ] `metadata-types/`：text/date/datetime/number/url/tel/color/object/array
- [ ] `EditorView.svelte`：三视图（editor/split/preview）+ 工具栏 + 自动保存
- [ ] 移动端编辑体验（软键盘自适应 + 工具栏固定）

### 阶段 6：预览管线

- [ ] `MarkdownViewer.svelte`：marked + Shiki + GFM
- [ ] `render-processors.ts`：可插拔 HAST 处理器（架构留出）
- [ ] `shiki-highlighter.ts`：Shiki 双主题单例
- [ ] 阅读卡片 markdown 截断预览（3-8 行 max-height + 雾化效果）

### 阶段 7：各个视图模块

- [ ] `/feed` FeedView：阅读模式时间线（articles + events 卡片流）
- [ ] `/article/$id` ArticleView：文章详情（MarkdownViewer + TOC + scroll-spy）
- [ ] `/editor/$collection/$id` EditorView：编辑器（阶段 5 主体）
- [ ] `/files` FilesView：GitHub 文件树浏览
- [ ] `/changes` ChangesView：暂存变更 + commit
- [ ] `/tags/$tag` TagsView + `/archive/$year/$month` ArchiveView
- [ ] `/search` SearchView（pop）：全文搜索（minisearch）
- [ ] `/settings` SettingsView：登录态、偏好、快捷键
- [ ] `/git` GitView（bottom）：git 状态面板

### 阶段 8：打磨与测试

- [ ] 暗色模式（跟随系统 + 手动切换持久化）
- [ ] View Transitions（tab/视图切换过渡）
- [ ] PWA（manifest + service worker）
- [ ] 可访问性（键盘导航 + aria + focus trap）
- [ ] Playwright E2E（登录、新建文章→编辑→commit、tab 拖拽、移动端）
- [ ] `pnpm check` + `pnpm test` 全绿

## 不做（明确边界）

- ❌ 实时协同（第一阶段只做普通模式，架构留升级路径）
- ❌ i18n 多语言（只保留中文原稿，翻译系统留后续）
- ❌ lit customElements 按需加载（旧 TODO 项目）
- ❌ streamdown 流式渲染（用 marked + Shiki 替代）
- ❌ AI 封面图生成（旧 TODO 项目）
