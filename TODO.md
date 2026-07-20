# TODO List

本文件追踪 gaubee.com 的开发任务。

## 历史阶段：Astro 静态博客时期（已完成，代码保留在 git 历史）

旧版本基于 Astro 5 + React，在 `388208c` 处归档。

## 第一阶段：Svelte 编辑器（普通模式，已完成）

将站点从静态博客升级为 Svelte 实时协同编辑器（普通模式）。8 个阶段全部完成。

## 第二阶段改造：SSG 阅读站 + 异步 VFS + Bug 修复（已完成）

### ✅ 批次 1：异步虚拟文件系统（VFS）核心
- `src/lib/vfs/vfs.ts`：扁平 IndexedDB + Unix API（readFile/writeFile/unlink/readdir/stat/fetch/commit）
- 三层读取优先级（本地修改 > 远程缓存 > 在线拉取），统一旧的 stagedChanges + contentCache
- Trees API 增量同步（sha 比对），并发池限速
- 修复 commit 删除分支（tree 省略 path）
- 19 个单元测试

### ✅ 批次 2：视图层迁移至 VFS
- EditorView/FilesView/ChangesView/SearchView/MetadataEditor/GitView 全部改用 vfsStore
- 修复：暂存读取（Bug #1）、竞态（#3）、新建文章（#5）、索引刷新（#7）、YAML 丢字段（#8）

### ✅ 批次 3：Worker 匿名回退 + 安全加固
- `/api/proxy/*` GET 无 token 匿名请求 GitHub（公开仓库可读）
- 写操作必须 token；路径限定 `repos/gaubee/gaubee.com/`（防 SSRF）
- CORS 生产严格白名单（dev 才允许 localhost）

### ✅ 批次 4：根 layout 中性化 + URL 分离
- 根 layout 简化为中性壳（不 import NavController）
- SPA 骨架下沉到 `[...path]/+layout.svelte`（ssr=false）
- 为 SSG 路由铺路

### ✅ 批次 5：SSG 阅读站（`/pages/*`）
- 构建时从本地 `src/content` 预渲染静态 HTML
- 文章详情、归档、标签、首页 feed、raw markdown 端点
- SEO 完整（title/description/og/canonical），no-JS 友好，AI 友好
- SPA ↔ SSG 互链（在编辑器打开 / 公开预览）

### ✅ 批次 6：验证 + 文档
- agent-browser 走查：SPA 编辑器 + SSG 阅读站 + 互链全正常
- 18 个 E2E 测试（10 桌面 SPA + 2 移动 + 6 SSG 含 2 个 no-JS）
- 73 个单元测试（nav + frontmatter + VFS）

### ✅ 批次 7：纯前端 bash 工具 + Bug 修复 + 体验打磨 + SW

#### Bug 修复
- `--radius: 0rem → 0.5rem`（shadcn luma style 正确值，圆角全部失效已修复）
- SSG 代码块 Shiki 高亮失效：根因是 `render.ts` 的 renderer 只实例化未 `marked.use`
  注册，修正后 44 篇含代码块文章全部正确高亮（Kotlin/Mermaid 走 plain fallback）
- `MarkdownViewer`/`render.ts` 图片 renderer 补 HTML 转义（防 XSS 属性逃逸）
- 清理 `frontmatter.ts` 死代码 `FRONTMATTER_RE`（用了 JS 不支持的 `\A`）

#### 体验打磨（UI 规范 + a11y）
- Feed/Tags 卡片补 `role=button` + `tabindex` + Enter/Space keydown（键盘可达）
- Editor/Pop Dialog 补 `Dialog.Description`（消除 aria 警告）
- 全局 `:focus-visible` 焦点环（自定义可点击元素兜底）
- 注：CodeMirror 暗色联动经实测**早已通过 CSS 变量自动跟随**，无需 Compartment，划掉此项

#### 纯前端 bash 工具（基于 VFS，接入 bottom 区）
- `src/lib/terminal/shell.ts`：命令内核 + tokenizer（空格/单双引号/转义）
- 15 个命令：ls/cat/echo/rm/touch/write/stat/find/pwd/cd/clear/help + git status/commit/pull
  （git 复用 `vfs.commit`/`dirtyFiles`，一行完成提交闭环）
- 设计：git 子命令不进通用 registry（避免 Tab 补全污染），由 runLine 的 git 分发器路由
- `src/lib/terminal/TerminalController.ts`：xterm readline 循环
  （光标移动、历史 ↑↓、Tab 补全、Ctrl+A/E/U/K/W/L/C）
- `src/lib/views/TerminalView.svelte`：bottom 区视图 + Svelte 移动端输入条
  （文本框 + Tab/^C/Clr/↵ 快捷键，弥补触屏 xterm 输入体验）
- 路由：替换占位的 `/preview-server` 为 `/terminal`（TabId/ALL_TABS/nav-items/placeholders）
- 删除未实现的 `PreviewServerView.svelte`（5 行占位）
- `/_test/terminal` 独立全屏测试页（Playwright 验证用）
- 50 个单元测试覆盖 tokenize/resolvePath/各命令/git/补全

#### Service Worker（仅加速 SSG 阅读站，无 PWA manifest）
- `static/sw.js`：stale-while-revalidate，仅缓存 `/pages/*`（跳过 raw）
  预缓存 `/pages` + `/pages/archive`，保证首次离线可用
- `src/lib/sw/register.ts`：仅 production + browser 注册（dev 不注册避免破坏 HMR）
- 支持 `VITE_DISABLE_SW=true` 应急禁用
- E2E 离线测试：`context.setOffline(true)` 后 `/pages` 仍返回 200

#### 验证
- 类型检查 0 错误，单元测试 130 个（+50 bash），E2E 19 个（+1 SW 离线）
- Playwright 截图验证：终端命令执行、暗色主题、圆角恢复、SSG 高亮全部正常

### ✅ 批次 8：响应式布局严重 bug 修复 + 终端布局修复 + E2E 补全

#### agent-browser 走查发现的严重预存 bug（生产桌面布局完全损坏）
- **根因 1（容器查询自循环）**：`.app-layout` 既是容器（`container-type: inline-size`），
  又是 `@container app (min-width: 768px)` 规则改变自身 `flex-direction` 的目标。
  浏览器为避免循环依赖，**忽略了对容器自身尺寸相关属性的声明**（实测 `!important`
  也无效）。结果桌面视口下 `.app-layout` 始终是 `flex-direction: column`（移动布局）。
- **根因 2（内联样式覆盖容器查询）**：`MobileHeader`/`MobileTabBar`/`StatusBar`
  三个组件有 `style="display: flex"` 内联样式，优先级高于容器查询的 `display: none`，
  导致桌面视口下移动端组件（汉堡菜单、底部 tab bar）与桌面侧栏**同时显示**。
- **影响**：生产环境桌面端 sidebar + mobile-header 重叠、app-body 被挤压到视口底部
  1/3、终端展开后 xterm 溢出覆盖 StatusBar（暗色按钮无法点击）。

#### 修复
- `app.css`：`.app-layout` 的 `flex-direction: row` 改用 `@media (min-width: 768px)`
  （视口级，不依赖容器查询自循环）；`display` 切换仍用 `@container`（组件级）。
- `MobileHeader.svelte`/`MobileTabBar.svelte`/`StatusBar.svelte`：移除 `style="display: flex"`
  内联样式，完全交给 `app.css` 的容器查询控制。

#### 终端布局修复（批次 7 遗留）
- `BottomAreaRouter.svelte`：bottom-area 加 `shrink-0`（原作为 flex item 默认
  `flex-shrink:1`，被 main 压缩成 1px，导致 xterm 溢出覆盖 StatusBar）。
- `AreaOutlet.svelte`：给 view 注入 `{area, tabId, isActive}` props。
- `TerminalView.svelte`：只在 `area === 'bottom'` 渲染 UI + 挂载 xterm（修复 AreaOutlet
  跨 area 常驻渲染导致 2 个 xterm 实例冲突）；容器加 `min-h-0` 约束 xterm 不溢出。

#### E2E 补全（+14 个测试，共 33 个 E2E）
- `tests/layout.e2e.ts`（4 个）：桌面/移动布局切换断言、组件不重叠、bottom 展开后
  暗色按钮可点击（历史 bug 回归保护）。
- `tests/terminal.e2e.ts`（10 个）：xterm 单实例、命令执行、收起/展开恢复、
  移动端抽屉切终端、输入条交互等。

#### 验证
- 类型检查 0 错误，单元测试 130/130，E2E 33/33
- agent-browser 截图：桌面 row 布局 + 侧栏 + 移动端组件正确隐藏；移动 column 布局正常

## 当前架构（第二阶段改造后）

```
gaubee.com/
├── /                    # SPA 编辑器（一站式 IDE 体验，NavController 多区域 tab）
├── /pages/*             # SSG 阅读站（SEO + no-JS + AI 友好，构建时静态化）
│   ├── /pages                          # 首页 feed
│   ├── /pages/article/[c]/[stem]       # 文章详情（含 SEO + raw md 链接）
│   ├── /pages/archive                  # 归档
│   ├── /pages/tags/[tag]               # 标签
│   └── /pages/raw/[...path].md         # 原始 markdown（text/markdown）
├── /editor /files /changes ...  # SPA 编辑器路由（catch-all 兜底）
└── SPA ↔ SSG 互链
```

数据层：
- **VFS（前端）**：IndexedDB 扁平存储 + Unix API，三层读取（本地修改 > 缓存 > 在线）
- **构建时（SSG）**：直接读本地 `src/content/*.md`，不走 GitHub API
- **Worker 代理**：未登录可匿名读公开仓库，写需登录

## 后续阶段（未来规划）

### 纯前端 bash 工具（批次 7 已完成基础，可继续扩展）
- [x] 基于 VFS 的 bash 命令（ls/cat/echo/rm/touch/stat/find/git 等，15 个）
- [x] 终端 UI（xterm.js + Svelte 输入条，接入 bottom 区）
- [ ] 管道 `|` / 重定向 `>` `>>`（批次 7 范围外，后续按需）
- [ ] grep、脚本执行（.sh 文件批处理）
- [ ] 更完整的 shell 语义（环境变量 `$`、通配符 `*`、命令链 `&&` `||`）
- [x] 安全沙箱（纯前端，无后端执行 —— VFS 天然沙箱）
- [ ] 升级为 openspecui 原版 xterm-input-panel（触屏虚拟键盘/触控板，需引入 lit+pixi）

### 实时协同（第三阶段）
- [ ] Yjs/CRDT 多人实时编辑
- [ ] WebSocket 服务（Cloudflare Durable Objects）
- [ ] 光标/选区共享、在线状态

### i18n 多语言（第四阶段）
- [ ] 英文翻译系统（增量翻译 + hash 去重）
- [ ] 多语言路由（/pages/en/...）
- [ ] AI 翻译（Gemini）

### 体验打磨（持续）
- [x] ~~CodeMirror 暗色模式联动~~（实测已通过 CSS 变量自动跟随，无需额外工作）
- [ ] 图片 LQIP / 响应式 srcset / PhotoSwipe（SSG + SPA 通用）
- [ ] 移动端 bottom 区浮层化（Sheet/Drawer 承载，支持 touch resize）
- [x] shadcn-svelte 规范修正（focus-visible 焦点环、Dialog Description 已补）
- [x] 可访问性（Card onclick 键盘可达已修；aria-live 动态通告待补）
- [ ] 性能（view 懒加载、Feed 虚拟滚动；Shiki 已是构建期一次性 + 客户端懒加载）
- [x] ~~--radius 确认~~（已修复为 0.5rem）
- [ ] PWA（manifest；批次 7 已实现 SW 加速，manifest 待补）
- [ ] 扩展 Shiki CORE_LANGS（加 Kotlin/Rust/Go 等减少 fallback）

### 部署
- [ ] Cloudflare Pages（静态主体）+ Workers（OAuth）正式部署
- [ ] GitHub OAuth App 配置（Client ID/Secret）
- [ ] CI/CD（替换旧的 Astro workflow）
