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

