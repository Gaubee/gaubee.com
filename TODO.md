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

## 第三阶段：GaubeeOS 应用系统架构重构（已完成）

### 架构理念
- **虚拟文件系统**：只读层（构建时静态数据）+ 可写层（IndexedDB）+ 授权机制
- **Everything is File**：应用通过 VFS 路径共享数据
- **硬装（静态）+ 软装（应用）**：前端框架固定，应用按需加载
- **应用即文件**：每个应用 manifest 声明 VFS 所有权、CLI 命令、路由

### 应用分类
| 类别 | 应用 | 状态 |
|---|---|---|
| 系统内置（不可卸载） | 文章、说说、搜索、设置、通知 | ✅ 全部完成 |
| 默认安装（可卸载） | Github、Terminal | ✅ 全部完成 |
| 可选安装 | 写作 | ✅ 基础框架完成 |

### 已完成工作

#### 1. 应用基础设施
- `src/lib/apps/types.ts`：AppManifest、CliCommand、AppEntry 类型
- `src/lib/apps/AppManager.svelte.ts`：应用安装/卸载/持久化/按需加载
- `src/lib/apps/registry.ts`：统一注册所有应用
- `src/lib/apps/PathManager.ts`：PATH/bin 命令注册管理

#### 2. NavController 动态化
- TabRegistry 注入机制（setTabRegistry/getTabRegistry）
- 动态 TabId（从静态枚举改为运行时字符串）
- 新旧路径兼容（localStorage 旧数据过滤 + POP_ROUTES 兼容）

#### 3. 路径统一
- 旧路径 `/feed`、`/editor`、`/git`、`/terminal` 等 → 新路径 `/app/*`
- 仅保留 `/app/articles`、`/app/shout`、`/app/settings`、`/app/search`、`/app/notifications`、`/app/github`、`/app/terminal`、`/app/writer`

#### 4. 文章应用（纯只读）
- `ArticlesView`：从 `ReadonlyVFS`（构建时静态数据）读取
- 无需登录，零延迟加载
- 按日期排序，卡片式布局

#### 5. 说说应用（纯只读）
- `ShoutView`：从 `ReadonlyVFS` 读取 events 目录
- 无需登录，零延迟加载

#### 6. Github 应用（基于 isomorphic-git）
- `GitStore.svelte.ts`：封装 isomorphic-git（clone/pull/commit/push）
- `GithubView.svelte`：支持绑定任意仓库、查看提交历史
- 内存文件系统适配器（MemFS）
- CORS 代理处理 GitHub 请求

#### 7. Terminal PATH 机制
- `shell.ts`：新增 `registerPathCommand`/`unregisterPathCommand`
- `AppManager`：安装/卸载时自动注册/注销 CLI 命令
- 应用 manifest 声明 `cliCommands`，安装后自动暴露到 PATH

#### 8. 视图注册系统
- `placeholders.ts`：统一注册所有 tab/pop/deep-link 视图
- 支持新旧路径双轨运行（已废弃旧路径）

#### 9. 组件测试
- `ArticlesView.svelte.spec.ts`：挂载 + 标题验证
- `ShoutView.svelte.spec.ts`：挂载 + 标题验证
- `WriterView.svelte.spec.ts`：挂载 + 标题验证
- `GithubView.svelte.spec.ts`：挂载 + 标题验证
- 共 **138 个测试全部通过**

#### 10. 内容阅读与搜索体验（2026-07-21）

- [x] 文章列表按年份分组，桌面侧栏与移动 Sheet 使用同一组年份入口。
- [x] 长文目录复用 GFM heading id；桌面固定目录与移动 Sheet 均可定位正文。
- [x] 短评改为时间线，完整渲染 Markdown，长内容可原地展开。
- [x] 搜索以应用服务协议扩展；构建期生成按应用和时间排序的 MiniSearch 分片。
- [x] 移动抽屉改为读取 AppManager，已安装应用在移动端可访问。
- [x] Playwright 测试通道使用 pnpm 生产预览，并支持 `PLAYWRIGHT_BASE_URL` 复用既有服务。

#### 11. 文章详情右侧目录（2026-07-22）

- [x] 宽桌面将文章目录放在正文右侧；拉伸侧栏承载吸顶，内部目录独立滚动。
- [x] 正文列以 `72ch` 控制行宽；中等宽度及移动端回退到可访问的目录 Sheet。
- [x] E2E 覆盖右侧几何关系、吸顶行为和 Sheet 回退，且完成生产预览走查。

#### 12. 文章列表右侧年份目录（2026-07-22）

- [x] 宽桌面将年份目录放在文章流右侧；拉伸侧栏承载吸顶，内部目录独立滚动。
- [x] 列表正文限制为 `44rem`；中等宽度及移动端回退到年份 Sheet。
- [x] E2E 覆盖年份目录的右侧几何关系、吸顶行为和 Sheet 回退，且完成生产预览走查。

### 架构图
```
GaubeeOS/
├── 硬装（静态框架）
│   ├── SPA 布局（DesktopSidebar / MobileHeader / MobileTabBar / StatusBar）
│   ├── NavController（多区域 tab 路由）
│   └── VFS 分层（只读层 + 可写层）
│
├── 软装（应用系统）
│   ├── 系统应用：文章、说说、搜索、设置、通知、账户
│   ├── 默认安装：Github（isomorphic-git）、Terminal（PATH/bin）
│   └── 可选安装：写作
│
├── 数据流
│   ├── 只读层：构建时 → ReadonlyVFS → 文章/说说
│   ├── 可写层：IndexedDB → VFS → 写作/Github
│   └── 提交器：GitHub API → 异步任务编号
│
└── 扩展点
    ├── CLI：PATH/bin 注册（gh、git、自定义命令）
    ├── VFS 授权：应用间路径权限共享
    └── 应用服务总线：manifest.services → gaubeeos.getAppService
```

#### 13. 账户系统应用 + 应用服务总线（2026-07-23）

深度优化登录模块，参考 macOS/Windows 系统账号登录，建立 OS 级应用服务总线。

- [x] **应用服务总线基础设施**（`src/lib/os/services/`）：
  - `types.ts`：AppService 契约、ServiceDeclaration（manifest.services 声明项）。
  - `registry.ts`：AppServiceRegistry 单例（serviceId → { appId, factory }），生命周期由 AppManager 驱动。
  - `bus.ts`：`gaubeeos.getAppService(id)` / `requestAppService(id)` 全局入口，类型安全（ServiceTypeMap），按需启动应用。
  - 自定义错误 `AppServiceNotInstalled`、`NotAuthenticatedError`。
  - 这是现有 searchService 扩展点范式的自然泛化（单一能力 → 任意命名 service）。
- [x] **AccountApp（账户系统应用）**：
  - `builtin/account/`：manifest（system 应用，hiddenFromNav 深链接）、service（封装 authStore）、AccountView（参考 macOS 账户面板）。
  - AccountService 暴露 state/login/logout/refresh/requireAuthenticated，其它应用经总线获取，不再直接 import authStore。
  - 修复技术债：`vfs.ts` 读 httpOnly cookie 误判（恒 false）改用 accountService.isAuthenticated；GitStore 失效的 require() token 获取清理。
- [x] **Settings 解耦**：
  - `settings-sections.ts`：SettingsSectionRegistry，设置面板入口动态注册（link 跳转 / render 内联）。
  - SettingsView 从硬编码账户卡片改为遍历 registry 动态渲染；AccountApp 自行注册「账户」入口。
  - 谁提供能力谁注册入口；设置应用不反向依赖业务应用。
- [x] **迁移 authStore 消费者**：StatusBar/WriterView/GithubView/FeedView/FilesView/+layout 全部改用 accountService，登录入口跳转 `/app/account`。
- [x] **GitService（GitApp 服务化）**：
  - `installable/github/service.ts`：GitService 接口（readFile/writeFile/dirtyFiles/commit/revert/sync），委托 VFS（认证有效路径）。
  - commit 内部 require account 鉴权；统一收口写仓路径。
- [x] **WriterApp 发表功能**：
  - EditorView 工具栏新增「发表」按钮：保存 → 经 GitService commit → 错误处理（未登录引导 /app/account，未装 GitApp 提示安装）。
  - WriterView 新增「批量发表」入口（VFS dirty 文件统一提交）。
  - 三方松耦合：写作 → git service → account service，经总线通信。
- [x] 验证：类型检查零新增错误（22 个预存错误不变）；142 个单元测试全过；Playwright 视觉验证设置页/账户页/编辑器发表按钮均正常。

#### 14. 路径分裂修复 + NotificationService（2026-07-23）

修复迁移到 /app/* 新路径体系时遗留的导航/编辑器/pop 三处路径分裂 bug，并建立 NotificationService。

- [x] **导航层路径分裂修复**（移动端 tab 栏空白等）：
  - 根因：`nav-items.ts` 用旧路径（/feed、/editor），而 mainTabs 是 /app/* 新路径，`getNavItem()` 恒返回 undefined。
  - 删除 `nav-items.ts`，MobileTabBar/MobileHeader/StatusBar/BottomAreaRouter 改用 `appManager.findByRoute()`（对齐 AreaNav 已有范式）。
  - 修复后：移动端 tab 栏显示「文章/说说/设置」，顶栏标题随应用变化（不再恒为 "Gaubee"）。
- [x] **编辑器路由断链修复**：
  - 根因：`/editor/...` 既非 tab 也未注册深链接，所有「打开编辑器」入口指向死路径。
  - 新增 `registerDeepLinkView("/app/editor", EditorView)`，EditorView 正则改为 `/app/editor/...`。
  - 统一 WriterView/FilesView/ArticleView/SSG 文章页的跳转为 `/app/editor/{collection}/{stem}`。
  - 修正 `/app/writer` tab 归属：渲染 WriterView（文件列表），`/app/editor/...` 深链接渲染 EditorView。
- [x] **pop 弹层路径分裂修复**：
  - 根因：`POP_ROUTES` 硬编码旧路径 /search、/notifications，但 pop view 注册在 /app/search、/app/notifications。
  - `POP_ROUTES` 改为 `["/app/search", "/app/notifications"]`；search/notifications manifest 的 defaultArea 改 "pop" + hiddenFromNav。
  - controller.ts 默认 tabRegistry 移除 search/notifications（它们是浮层，不进 main tab）。
  - 修复后：桌面侧栏「浮层」分区显示搜索/通知入口，移动端铃铛弹层正常。
- [x] **NotificationService（架构演进）**：
  - `builtin/notifications/service.svelte.ts`：NotificationService（push/markAllRead/clear/history/unreadCount），即时 toast + 持久化历史（localStorage）。
  - 导出便捷函数 notifySuccess/notifyError/notifyInfo/notifyWarning（经 service，不可用时降级直接 toast）。
  - notifications manifest 声明 services.notification；bus.ts ServiceTypeMap 注册。
  - NotificationsView 从空壳改为渲染 service.history（未读角标、全部已读、清空）。
  - 迁移 19 处散落 toast：登录/发表/安装/提交等重要事件走 notify*（进历史），暂存/撤销等高频操作保留直接 toast（不噪音化历史）。
- [x] **健壮性修复**：
  - `requestAppService` 删除空 `loadView`（对 account/git 都是空操作且有负作用，改为只保证已安装 + 工厂懒构造）。
  - 降级快照语义修复：6 处 `?? { loaded: true }` 改为共享常量 `ACCOUNT_UNAVAILABLE`（loaded:false，显示骨架态而非伪装未登录）。
  - `vfs.ts` commit 空 dirty 改抛 `NoChangesError`（统一错误类型，单一可信源）。
- [x] 验证：类型检查零新增错误（20 个预存错误）；142 个单元测试全过（含更新的 controller pop 路径测试）；Playwright 视觉验证移动端 tab 栏/顶栏、桌面侧栏浮层、编辑器深链接、通知中心均正常。

#### 15. 统一 commit 路径 + git 命令正式声明（2026-07-23）

消除「两条 commit 路径」（GitService 带鉴权 vs 直接调 vfsStore 无鉴权），统一所有写操作经 GitService；把 git 命令正式声明为 github 应用的 cliCommands。

- [x] **git 命令迁移到 cliCommands 声明**：
  - 新建 `installable/github/commands.ts`：git status/commit/pull 实现为 CliCommand，内部走 `gaubeeos.requestAppService('git')`（鉴权守卫 + 类型化错误）。
  - github manifest 的 `cliCommands` 从空数组改为 `gitCommands`；删除指向不存在的 path.ts 的死注释。
  - shell.ts 删除 95 行硬编码 git 命令实现；runLine 的 git 分发器改为动态 import github/commands 的 gitSubcommandMap（延迟 import 避免循环依赖）。
  - 未登录时 `git commit` 提示「需要先登录账户」，而非裸 GitHub API 错误。
- [x] **ChangesView 走 GitService**：
  - handleCommit 从 `vfsStore.commit`（无鉴权）改为 `gaubeeos.requestAppService('git')` + `git.commit`（带鉴权）。
  - 复用 `handlePublishError` 统一错误处理（未登录引导 /app/account）。
  - 至此所有写操作（EditorView 发表、WriterView 批量发表、ChangesView 提交、shell git commit）统一经 GitService.commit，都带鉴权守卫。
- [x] **vfsStore.commit 并发互斥**：
  - 加 `commitInFlight` 锁（仿 sync 的 inFlight 模式），并发 commit 合并为同一 Promise，消除重复提交竞态。
  - 连点发表/提交按钮时，第二次调用复用第一次的 Promise（同一批变更只提交一次）。
- [x] **代码卫生**：writer manifest 删除「提供 CLI 命令：write」的矛盾注释（cliCommands 实为空）。
- [x] 验证：类型检查零新增错误（20 个预存不变）；142 个单元测试全过（含 mock gaubeeos 的 shell git 测试）；Playwright 验证终端 git status 正常、git commit 未登录提示登录。

#### 16. 核心测试补齐 + 401鉴权映射 + GitStore清理 + 编辑器修复 + diff预览（2026-07-23）

审视后合并 P0（测试/401/文档）与 P1（GitStore清理/编辑器修复/diff），补齐核心架构的测试保障并修复多个真实 bug。

- [x] **核心单元测试补齐**（新增 51 用例，142→193）：
  - `os/services/registry.test.ts`（10）：同步/异步工厂、懒构造缓存、register/unregisterApp、覆盖。
  - `os/services/bus.test.ts`（4）：getAppService/hasService/requestAppService 委托与 AppServiceNotInstalled。
  - `os/services/publish-helper.test.ts`（5）：四个 instanceof 错误分支契约。
  - `github/client.test.ts`（6）：401/403→NotAuthenticatedError 映射、各阶段失败。
  - `builtin/settings-sections.test.ts`（4）：order 排序稳定性。
  - `builtin/account/service.test.ts`（7）：requireAuthenticated 守卫、state 委托、ACCOUNT_UNAVAILABLE。
  - `installable/github/service.test.ts`（8）：commit 鉴权+空dirty守卫、读写委托。
  - `vfs/vfs.svelte.test.ts`（3，client 浏览器）：commitInFlight 互斥、sync inFlight 合并。
- [x] **401→NotAuthenticatedError 映射**：client.ts 加 assertOk 辅助函数，401/403 转成 NotAuthenticatedError。会话过期时 handlePublishError 的鉴权引导分支终于命中（之前显示通用「失败:401」，现在引导重新登录）。
- [x] **GitStore 死代码清理**：删 add/commit/push/changedFiles/hasRepo（无消费方且 push 因无 token 不可用）；clone 简化为匿名；GithubView 加只读说明（指向写作/变更应用）；顺带修预存 defaultBranch 类型错误。
- [x] **EditorView 保存逻辑修复**：提取 flushSave() 共享函数；handleSave 改为立即落盘（之前只是重启 1s debounce）；loadPost 切文章前 flushSave（避免丢未保存内容/写错路径）。
- [x] **ChangesView diff 预览**（VFS base 快照方案）：
  - VfsRecord 加 baseContent 字段（首次 dirty 时保存原始内容，commit/revert 清除）。
  - 新建 `utils/diff.ts`（LCS 行级 diff，大文件截断）。
  - ChangesView 改为 diff 渲染：新建/删除/修改三种类型标签 + 行级彩色 diff（绿增红删）+ 增删行数统计。
- [x] **AGENTS.md 更新**：修正技术栈（react→svelte）、类型检查命令（pnpm ts→pnpm -w run check）、补应用服务总线架构说明（声明三步流程、依赖方向、contentStore 例外）。
- [x] 验证：类型检查零新增错误（19 个预存）；193 个单元测试全过；Playwright 验证编辑器保存、GithubView 只读说明正常。




