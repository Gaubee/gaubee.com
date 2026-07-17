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

### 纯前端 bash 工具（下一轮，VFS 已铺好挂载点）
- [ ] 基于 VFS 的 bash 命令（ls/cat/echo/grep/git 等）
- [ ] 终端 UI（xterm.js，接入 bottom 区）
- [ ] 管道、重定向、脚本执行
- [ ] 安全沙箱（纯前端，无后端执行）

### 实时协同（第三阶段）
- [ ] Yjs/CRDT 多人实时编辑
- [ ] WebSocket 服务（Cloudflare Durable Objects）
- [ ] 光标/选区共享、在线状态

### i18n 多语言（第四阶段）
- [ ] 英文翻译系统（增量翻译 + hash 去重）
- [ ] 多语言路由（/pages/en/...）
- [ ] AI 翻译（Gemini）

### 体验打磨（持续）
- [ ] CodeMirror 暗色模式联动（编辑器代码高亮跟随 .dark）
- [ ] 图片 LQIP / 响应式 srcset / PhotoSwipe（SSG + SPA 通用）
- [ ] 移动端 bottom 区浮层化（Sheet/Drawer 承载，支持 touch resize）
- [ ] shadcn-svelte 规范修正（space-y→gap、focus-visible 焦点环、Dialog Description）
- [ ] 可访问性（Card onclick 键盘可达、aria-live 动态通告）
- [ ] 性能（view 懒加载、Shiki 动态 import、Feed 虚拟滚动）
- [ ] --radius 确认（当前 0rem 让所有圆角失效）
- [ ] PWA（manifest + service worker，移动端离线）

### 部署
- [ ] Cloudflare Pages（静态主体）+ Workers（OAuth）正式部署
- [ ] GitHub OAuth App 配置（Client ID/Secret）
- [ ] CI/CD（替换旧的 Astro workflow）
