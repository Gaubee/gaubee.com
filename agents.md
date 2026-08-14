## Project Configuration

- **Language**: TypeScript
- **Package Manager**: pnpm
- **Add-ons**: tailwindcss, vitest, playwright, mdsvex, sveltekit-adapter

---

## 必读

- [`TARGET.md`](./TARGET.md) 是我们的目标指南。
- [`TODO.md`](./TODO.md) 是我们的代办任务。

## AI 协作指南

本文件旨在记录与 AI 助手（Jules）协作时的工作流程和偏好，以确保沟通顺畅、高效。

> _本指南会根据我们的合作进展随时更新。_

1. 沟通与规划
   - **中文沟通**: 我们之间的所有沟通都将使用中文。
   - **明确计划**: 在开始任何实质性的编码工作之前，AI 需要提供一份清晰、分步的执行计划。计划需要获得我的批准后才能开始执行。
   - **任务追踪**: 使用根目录下的 `TODO.md` 文件来追踪项目的宏观任务和未来规划。
2. 开发技术栈：
   1. sveltekit
   1. svelte 5（runes 响应式）
   1. vite
   1. vitest（双 project：server=node 纯逻辑，client=浏览器组件/runes）
   1. playwright
   1. tailwindcss v4
   1. shadcn-svelte（shadcn/ui 的 svelte 版）
   1. @lucide/svelte（注意：lucide 因商标移除了 brand 图标如 github）
   1. adapter-static（SSG + SPA 混合）
3. 开发流程
   - **Commit Message 规范**: 所有的 Git 提交信息（Commit Message）都必须使用中文书写，清晰地描述本次提交的内容。
   - **提交前检查**: 在执行 `submit` 操作之前，必须完成以下检查：
     1. **运行类型检查**: 执行 `pnpm -w run check` 来确保没有 TypeScript 类型错误。
     2. **运行测试**: 如果项目中有自动化测试，必须全部运行并通过。
     3. **代码审查**: 调用 `request_code_review()` 工具来获取代码变更的反馈。
   - **前端验证**: 如果进行了任何前端 UI 相关的更改，必须在提交前执行 `frontend_verification_instructions` 并遵循其指示完成验证。
   - **测试环境**: 我们的开发环境中已经安装了 `npm:playwright`、`npm:vitest` 的相关依赖了。方便 AI 使用 vitest/playwright 来编写测试代码。
     1. 使用 `pnpm -w run test:e2e` 来执行 playwright 测试脚本。
        1. 使用之前请仔细阅读 `playwright.config.ts` 文件。
           > 比如你可以通过环境变量`PLAYWRIGHT_BASE_URL`来自定义`page.goto('/')`的baseUrl
        2. 或者自己执行 `pnpm -w run playwright` 去做更加仔细更加可控的的测试运行
     2. 使用 `pnpm -w run test:unit --run` 来执行 vitest 测试脚本
        > server project（node）测纯逻辑用 `*.test.ts`；client project（浏览器）测含 runes/组件用 `*.svelte.test.ts`
     3. **headless 登录态**（agent-browser 走查需登录的应用时）：headless 浏览器默认无会话。
        运行 `./scripts/dev-login.sh` 可从 `gh auth token` 取 token 并注入 Worker 的 gh_token cookie，
        让 headless 浏览器进入登录态（不碰用户浏览器 Profile，token 仅存于临时 session）。
        前置：`gh auth login` 已完成 + Worker 在跑（`cd worker && pnpm dev`）。
   - **单元测试**: 在`src/lib`下与源码同目录开发 vitest 测试代码来验证基础功能（参照 `*.test.ts` / `*.svelte.test.ts`）。也可以开发 Playwright 脚本，用来做组件可用性可靠性验证。
   - **技术验证**: 在`tests/jules-scratch`文件夹下，使用 Playwright 脚本 + 截图的方式进行验证。这套流程（启动服务 -> 编写/运行脚本 -> 生成截图 -> 分析截图 -> 修复 -> 再次验证）被证明是定位和解决布局等视觉问题的有效方法。
4. 分支与提交
   - **分支命名**: 功能开发分支应使用 `feat/` 前缀，例如 `feat/redesign-ui`。修复 bug 的分支应使用 `fix/` 前缀。
   - **提交**: 当所有工作完成并通过检查后，使用 `submit` 工具提交代码。

## 快速开始

- 使用 `pnpm -w run dev` 可以启动http服务
- 使用 `pnpm -w run check` 来获取ts类型检查，使用`pnpm -w run check:watch`可以实时监控

## 部署架构（2026-08-14 更新：双通道）

### 心智模型

```
gaubee.com（zone 在 Cloudflare）
├── 主站静态站（双通道，同一构建产物）
│   ├── 国内服务器（备案合规主通道，2026-08-14 起）
│   │   ghcr.io/gaubee/gaubee.com 镜像 → docker compose（nginx 托管 build/）
│   │   DNS 将 gaubee.com A 记录切至国内服务器 IP（用户自行操作）
│   └── GitHub Pages（保留通道，4 条 A + www CNAME，灰云 DNS-only）
│       证书由 GitHub 自动签发；不可橙云代理（会致 Pages 证书验证失败/404）
└── auth.gaubee.com ── Cloudflare Worker「gaubae-auth」
                      经 Workers Custom Domain 绑定（自动签边缘证书 + 建路由）
                      职责：/auth/github（OAuth 发起）+ /auth/github/callback + /upload/image
```

主站域名不变（gaubee.com），前端直连 api.github.com + OAuth 跳 auth.gaubee.com，
故主站迁移不影响 Worker 的 CORS 白名单与 OAuth 三方一致性。

### 三方一致性（不可调和约束）

Worker 用 `WORKER_ORIGIN` 构造 GitHub OAuth 的 `redirect_uri`，故「Worker 域名」必须三处相同：

```
1. worker/wrangler.toml   WORKER_ORIGIN                 ← Worker 自身认知
2. 前端构建注入            VITE_AUTH_BASE（GitHub Secret / Dockerfile ARG，默认 https://auth.gaubee.com）
3. GitHub OAuth App       Authorization callback URL    ← GitHub 回跳目标
```

改任一处必须同步其余两处，否则 `redirect_uri` 与 callback 不匹配，GitHub 拒绝请求。当前生产值：`https://auth.gaubee.com`，callback：`https://auth.gaubee.com/auth/github/callback`。

### 关键约定

- **Workers Custom Domain 的硬约束**：要求 zone 在 Cloudflare nameservers 上 active。不可用裸 CNAME 指向 `*.workers.dev`——workers.dev 默认域的边缘证书不覆盖 CNAME 进来的自定义主机名，会触发 `ERR_SSL_VERSION_OR_CIPHER_MISMATCH`。
- **CI 防回退**：`main.yml` 与 `deploy-docker.yml` 构建前校验 `VITE_AUTH_BASE`（若配置）非空且 `https://` 开头；Dockerfile 内置同校验（默认值即生产值）。
- **协调切换窗口**：统一 `redirect_uri` 时，改 OAuth App callback → push 部署 Worker/前端 之间有几分钟中断窗口（旧前端跳旧域名但 callback 已改），选低峰。
- **敏感变量不入库**：`.env` 已 gitignore；`GITHUB_CLIENT_*` 用 `wrangler secret put` 配置，不入仓库。
- **Docker 镜像构建注意**（`Dockerfile`）：pnpm 锁 10.22.0（更新版 10.x 的 `--config.dangerouslyAllowAllBuilds` 与 `pnpm-workspace.yaml` 的 `onlyBuiltDependencies` 白名单互斥）；`.dockerignore` 严禁排除 `*.md`（`src/content/` 的 markdown 是内容本体）。
- **GHCR 私有性**：GITHUB_TOKEN 推送的包默认 private；服务器拉取需 `docker login ghcr.io`（PAT 带 read:packages）或在 GitHub 网页将 package 设为 public。（实测当前为 public，匿名可拉。）
- **Docker Hub 可选通道**：`deploy-docker.yml` 支持 `DOCKERHUB_USERNAME` + `DOCKERHUB_TOKEN`（Docker Hub Access Token，Read/Write）双发；未配置 secrets 时该通道自动跳过，CI 保持绿。

### 服务器部署（docker compose）

```
# 服务器上（compose 文件见仓库根 docker-compose.yml）
docker compose pull && docker compose up -d   # 默认宿主端口 8080，PORT 可覆盖
# 外层用自有 nginx/caddy 反代 8080 → 443 + TLS
```

镜像主通道为 Docker Hub（`docker.io/gaubee/gaubee.com`，国内服务器配镜像加速器后拉取快）；
ghcr.io 为备用通道（国内直连极慢，仅境外/加速器失效时用）。
服务器 dockerd 加速器配置（`/etc/docker/daemon.json`，改后 `systemctl restart docker`）：
优先云厂商专属加速器（阿里云 ACR 控制台专属地址 / 腾讯云内网 `mirror.ccs.tencentyun.com`），
公共兜底 `https://docker.m.daocloud.io` 或南大 `https://docker.nju.edu.cn`。

### 文件结构

```
worker/
├── wrangler.toml              WORKER_ORIGIN / APP_ORIGIN / ENVIRONMENT（本地 + 生产两段）
└── src/index.ts               Hono Worker：/auth/github + /callback + /upload/image

/（仓库根）
├── Dockerfile                 静态站镜像（node:22-alpine pnpm build → nginx:alpine）
├── docker-compose.yml         服务器部署入口（Docker Hub 主通道 + ghcr 备用，PORT 可覆盖）
├── deploy/nginx.conf          容器 nginx 配置（SPA/SSG 兜底 + 缓存矩阵 + md MIME）
└── .github/workflows/
    ├── deploy-worker.yml      worker/ 变更 → wrangler-action 部署（--env production）
    ├── deploy-docker.yml      main push → 镜像构建推送 ghcr.io/gaubee/gaubee.com（amd64）；配置 DOCKERHUB_* secrets 后双发 Docker Hub
    └── main.yml               前端 → GitHub Pages，注入 VITE_AUTH_BASE（带格式校验）
```

## 应用服务总线架构（2026-07-23）

### 核心机制

应用通过 `manifest.services` 声明能力（命名 service），其它应用经 `gaubeeos.getAppService(id)` 获取。这是 `searchService` 扩展点范式的泛化。

```
gaubeeos.getAppService('account')     → AccountService   （AccountApp，系统应用）
gaubeeos.getAppService('git')         → GitService       （GithubApp，默认安装）
gaubeeos.requestAppService('git')     → 异步按需启动 + 返回
gaubeeos.getAppService('notification')→ NotificationService（通知应用，系统应用）
```

### 声明一个新 service（三步）

1. **类型注册**：在 `src/lib/os/services/bus.ts` 的 `ServiceTypeMap` 加一行 `yourId: YourService`。
2. **manifest 声明**：在应用的 manifest 加 `services: { yourId: () => yourServiceSingleton }`。
3. **单例实现**：新建 service 文件实现 `AppService` 接口，导出单例。AppManager 在 init/install 时自动投影到 registry。

### 依赖方向约定

- service 实现内部依赖其它 service 时，**直接 import 单例**（如 `gitService` import `accountService`），不经过 `gaubeeos`/bus，避免循环依赖（bus → appManager → registry → 应用 → bus）。
- `bus.ts` 用 `import type` 引用各 service 接口（类型擦除，无运行时循环）。
- 网络层错误映射：`client.ts` 的 `assertOk` 把 401/403 转成 `NotAuthenticatedError`，让 `handlePublishError` 的鉴权引导分支生效。

### contentStore 例外

`contentStore`（`src/lib/data/content.svelte.ts`）是纯派生只读视图层（无鉴权、无写操作），允许视图直接 import，未 service 化。

## 类型安全路由系统（2026-07-27）

### 心智模型

```
URL (string)
  │
  ▼
NavController            ← 黑盒状态机（三 area 单 URL 编码），不修改
  │  输出 location.pathname / search
  ▼
AreaOutlet               ← 找到归属 manifest + Activity
  │  按 tabId 常驻 DOM（跨应用保活）
  ▼
<AppShell activity>      ← 内置 ActivityRouter
  │  通过 setRouterContext 下发 useRoute/useParams/useSearch
  ▼
<ActivityRouter>         ← matchRouteTree 解析 RouteContract 树
  │  按 RouteId 缓存组件（应用内保活）
  ▼
<View params search />   ← 类型安全 props（来自 zod schema）
```

### RouteContract：声明式路由节点

```ts
defineRoute({
  id: "github.repo.detail",       // 全局唯一 id
  pattern: "repo/:owner/:repo",   // 相对段，与父级拼接
  params: z.object({...}),        // pathname 参数 schema（zod）
  search: z.object({...}),        // query 参数 schema（zod）
  component: () => import("..."), // 视图懒加载
  children: [...],                // 嵌套子路由（无限层）
})
```

### 声明一个新 Route（三步）

1. **定义 Route**：在应用目录建 `routes.ts`，用 `defineRoute`（多页面）或 `leafRoute`（单页面）声明。
2. **挂到 Activity**：在 manifest 里 `defineActivity({ pattern, root })`，或直接 `{ pattern, entry, root }`。
3. **视图消费**：组件内 `useParams<T>()` / `useSearch<T>()` 拿到类型安全的参数。

### 导航 API（替代 navigateMain 字符串）

```ts
import { go, goById, targetById, buildHrefById } from "$lib/router";

// 同应用内：直接传 Route 单例（最强类型）
go(repoDetailRoute, "/app/github", { owner: "a", repo: "b" });

// 跨应用：字符串 RouteId（解耦，类型由 codegen 提供）
goById("github.repo.detail", { owner: "a", repo: "b" });

// 构造 target（用于 NotificationAction.to 等延迟跳转）
notifySuccess("成功", "查看", { to: targetById("github.repo.detail", { owner, repo }) });
```

### 关键约定

- **route id**：点号分隔小写，如 `github.repo.detail`（推荐 `app.scene.sub` 格式）。
- **Activity 内部多页面**：用 `root.children` 嵌套声明，**不再用组件内 path.match 正则分发**。
- **保活模型**：
  - 跨应用保活：AreaOutlet 按 tabId 常驻 AppShell DOM
  - 应用内保活：ActivityRouter 按 RouteId 缓存组件实例
- **SearchParams 不支持数组**：扁平 key-value，zod 做 coerce。
- **NavController 当黑盒**：navigate API 通过 NavControllerAdapter 注入，应用层不直接调 `navigateMain(string)`。
- **pop/bottom 区过渡**：search/notifications（pop）和 terminal（bottom）暂走 AreaOutlet 旧机制，root 字段仅供类型一致性，未来统一。

### 文件结构

```
src/lib/router/                  ← 路由系统核心
├── contract.ts                  RouteContract 类型
├── define-route.ts              defineRoute 工厂（含自注册）
├── define-activity.ts           defineActivity 工厂
├── leaf-route.ts                单页面快捷工厂
├── match.ts                     matchRouteTree 纯函数
├── path-pattern.ts              path-to-regexp 风格编译器
├── search.ts                    search 序列化
├── navigate.ts                  go/buildHref/targetById
├── registry.ts                  routeRegistry 单例
├── hooks.svelte.ts              useRoute/useParams/useSearch
├── ActivityRouter.svelte        Activity 内部渲染组件
└── __tests__/                   79 个单测

vite-plugins/gaubee-routes/      ← codegen 插件（骨架，阶段 3 完善）
```

## Markdown 链接规范（2026-07-28）

### 心智模型

文章（articles）/说说（events）正文里的 `<a>` 链接按 href 分类，统一走两套行为：

```
href 形态                分类          渲染输出                          点击行为
─────────────────────────────────────────────────────────────────────────────────
http(s):// mailto: tel:  external     <a class=md-link-external          新窗口打开
                                      target=_blank rel=noopener>        （浏览器原生）
//host 协议相对          external     同上                               同上

/articles/x /events/x    internal     <a data-internal-link>             SPA 应用内导航
/#路径                                                                    （click 委托拦截）

#section                 anchor       <a href=#section>                  页内锚点（原生）
./x.md x.md 相对路径     other        <a href=...>                       原生（README 场景
                                                                         由 readme.ts 改写）
```

### 核心 API

```ts
// src/lib/markdown/link.ts（客户端 + SSG 共享纯函数）
import { classifyLink, renderLinkTag } from "./link";

classifyLink("/articles/x"); // → "internal"
classifyLink("https://github.com"); // → "external"
classifyLink("#section"); // → "anchor"

// marked renderer.link 直接委托
renderer.link = ({ href, title, tokens }) => {
  const text = marked.Parser.parseInline(tokens as never);
  return renderLinkTag({ href, text, title });
};
```

### 关键约定

- **图标实现**：CSS `::after` + `mask`（DOM 零增节点，SSG 同步生效），`background: currentColor` 自动跟随链接色/悬停态/暗色模式。**不用** Svelte 组件渲染（SSG 同步函数拿不到组件上下文）。
- **内链拦截**：`MarkdownViewer` 容器 click 委托命中 `a[data-internal-link]` → `navController.navigateMain(href)`。修饰键（ctrl/meta/shift/alt）与中键放过走原生新窗。容器加 `role="presentation"`（交互语义由内部 `<a>` 承担，模式同 `RepoFileContent.svelte` 的 `data-repo-file`）。
- **不引入路径→RouteId 反向匹配**：markdown 内链走裸字符串 `navigateMain(path)`，与 `ArticleDetailView.svelte:78` 现有写法一致。反向匹配是新基建，成本不匹配。
- **readme.ts 保持独立**：GitHub README 的 `data-repo-file`（指向文件面板）是仓库专属语义，不接入本规范。
- **双层 prose 问题**（`ArticleDetailView` 外层 article + MarkdownViewer 内层都套 prose）不在本规范范围，记为 TODO。

### 文件结构

```
src/lib/markdown/
├── link.ts                   classifyLink + renderLinkTag（共享纯函数）
├── link.test.ts              分类边界 + XSS 转义测试（server project）
├── MarkdownViewer.svelte     客户端：renderer.link + click 委托
└── render.ts                 SSG：renderer.link（同步函数）

src/app.css                   .md-link-external::after 图标 + .shout-markdown 链接基础样式
```

## 加载状态机抽象（2026-07-28）

### 心智模型

网络数据加载从 3 态（loading/error/success）升级到 8 态拓扑，核心是中间态：`refreshing`（有旧数据时背景刷新，不闪骨架）和 `stale-error`（刷新失败保留旧数据 + 错误条）。

```
  无数据区                         有数据区
┌──────────────┐               ┌──────────────┐
│ idle         │               │ success      │ 已加载
│ loading      │ 首屏骨架      │ refreshing ★ │ 背景刷新，保留旧数据
│ empty        │ 列表空态      │ stale-error ★│ 刷新失败，保留旧数据 + 错误条
│ error        │ 首屏失败      │              │
└──────────────┘               └──────────────┘
```

### 核心 API

```ts
// 声明资源（runes 工厂）
const commits = createResource(
  () => listCommits({ owner, repo, perPage: 30 }),
  { isEmpty: (a) => a.length === 0, errorMessage: "加载历史失败" },
);

// 触发（监听参数变化，fetcher 闭包读响应式值）
$effect(() => { if (owner && repo) void commits.run(); });

// 渲染（AsyncBoundary 按 status 自动分支）
<AsyncBoundary resource={commits} skeleton={SkeletonSnippet} emptyMessage="暂无提交">
  {#snippet children()}
    {@const data = commits.data!}
    {#each data as c}<CommitRow {c} />{/each}
  {/snippet}
</AsyncBoundary>
```

### 内置能力

- **seq 竞态防护**：内置序号丢弃过期请求结果（替代手写 `searchSeq`/`loadSeq`）。
- **refreshing 保留旧 data**：有数据时重新 run，status=refreshing，data 不清空。
- **stale-error 保留旧 data**：刷新失败不清空 data，显示错误条 + 重试。
- **silent 选项**：辅助数据（repoInfo/counts/events）静默失败，不设 error。
- **isEmpty 列表空态**：列表资源配置后，空数据显示 empty 态而非 success。
- **setData mutation**：评论 CRUD 等本地更新（`setData(prev => [...prev, created])`）。

### 关键约定

- **位置**：`src/lib/apps/installable/github/state/`（GithubApp 内部，非全局 lib）。
- **协变接口**：AsyncBoundary 接收 `ReadonlyResource<out T>`（协变于 T），解决 `Resource<T>` 因 setData 逆变导致的类型不兼容。调用方在 children snippet 内用 `{@const data = resource.data!}` 取值（success 分支内非空安全）。
- **纯逻辑分层**：状态派生逻辑在 `status.ts`（server project 可测，纯函数），runes 集成在 `resource.svelte.ts`（client project `.svelte.test.ts` 测）。
- **不适用场景**：分页/增量加载（listCache、文件树 loadingDirs）形态不匹配，保持手写。

### 文件结构

```
src/lib/apps/installable/github/state/
├── status.ts                  状态机派生纯函数（idle/loading/refreshing/...）
├── status.test.ts             纯逻辑单测（server project）
├── resource.svelte.ts         createResource runes 工厂（Resource<T> + ReadonlyResource）
├── resource.svelte.test.ts    runes 行为测试（client project）
├── AsyncBoundary.svelte       状态机渲染边界（泛型，snippet 传 data）
├── EmptyState.svelte          空态（图标 + 文案）
├── ErrorState.svelte          错误态（图标 + 文案 + 重试，role=alert）
├── RefreshIndicator.svelte    refreshing/stale-error 顶部指示条
└── index.ts                   统一导出
```

## 提交规范

1. git-commit-message 的提交规范的格式为：

   ```md
   $GIT_EMOJI $SCOPE $TITLE

   $DETAIL_LIST
   ```

   1. `GIT_EMOJI` 给一些常见的：
      - ✨ `:sparkles:`: **新功能**: 引入新功能。
      - 🐛 `:bug:`: **修复Bug**: 修复一个 Bug。
      - ♻️ `:recycle:`: **重构**: 对代码进行重构，既不修复错误也不添加功能。
      - 📖 `:book:`: **文档**: 添加或更新文档。
      - 📝 `:memo:`: **内容**: 添加或更新内容。
      - ⚡️ `:zap:`: **性能**: 提升性能。
      - ✅ `:white_check_mark:`: **测试**: 添加、更新或通过测试。
      - 💄 `:lipstick:`: **UI/样式**: 添加或更新 UI 和样式文件。
      - 🔥 `:fire:`: **移除**: 移除代码或文件。
      - 🚀 `:rocket:`: **部署**: 部署相关。
      - 🚧 `:construction:`: **进行中**: 工作正在进行中，通常用于功能分支的持续提交。
   2. `SCOPE` 是一个或多个单词，概况修改的目标，比如可以用 ui/layout/content/lib/i18n ，通常跟文件夹的名称一致
      > 如果一次提交涵盖多个SCOPE，那么可以省略SCOPE，在`DETAIL_LIST` 详细列出每一个scope的提交内容
   3. 使用中文提交

2. 提交之前要更新 `TODO.md`，来将完成的任务补充进去。
3. 提交之前需要使用 `pnpm fmt` 脚本来统一格式化要提交的问题。

## 内容阅读与搜索架构（2026-07-21）

### 决策

- 文章与短评应用各自在 manifest 声明 `searchService` 工厂；搜索应用不得导入具体内容应用。
- 静态索引按应用、发布时间倒序和约 500 KiB 分片生成；浏览器只加载命中应用的分片。
- 移动导航必须从 `AppManager` 的已安装应用投影，不能回退到静态 `nav-items`。

```
src/content/{articles,events}
          │ build
          ▼
 static/search-index/{manifest,shards}
          │ lazy fetch
          ▼
AppManifest.searchService ──► Search registry ──► SearchView
          │                                      (Lucene + progressive batches)
          └── AppManager install / uninstall
```

### 阅读契约

- Markdown 目录与正文共用 `marked-gfm-heading-id` 结果；不得自行生成 slug。
- 目录、年份入口和长短内容展开均须提供桌面与移动的可访问交互。
- 宽桌面右侧目录由拉伸的 grid 侧栏承载：外层 `nav` 负责 `sticky top-8`，内层目录负责限高滚动；不得给侧栏使用 `self-start`，也不得将 sticky 放在内部滚动盒上。
- 对内容的搜索结果按日期优先显示；首个非空批次立即渲染，后续结果以窗口合并降低列表抖动。

### 验证入口

- `pnpm content:prepare` 生成只读 VFS 与搜索索引。
- `pnpm build` 是静态产物事实来源；SSG E2E 应在 production preview 中运行。
- `PLAYWRIGHT_BASE_URL` 用于复用已有服务器；未设置时 Playwright 自行运行 `pnpm build && pnpm preview`。

## 毛玻璃标准（backdrop-blur 固定搭配，2026-07-24）

### 为什么要标准化

`backdrop-blur` 模糊背后的内容后，前景文字/图标的可读性会受背景影响——亮图上白字看不清，暗图上黑字看不清。`backdrop-filter` 必须搭配固定的 `contrast`/`brightness` 滤镜来补偿，这是**固定搭配，不可拆分**。

### 标准搭配

```
亮色模式：backdrop-filter: blur(12px) contrast(2) brightness(0.8)
暗色模式：backdrop-filter: blur(12px) contrast(0.8) brightness(1.2)
```

- **亮色**：`contrast(2)` 增强边缘对比 + `brightness(0.8)` 压暗背景，保证深色前景文字在任意背景图上可读。
- **暗色**：`contrast(0.8)` 柔化 + `brightness(1.2)` 提亮背景，保证浅色前景文字可读。

### 使用方式

在 CSS 中用 dark variant 分别声明（项目用 `@custom-variant dark (&:is(.dark *))`）：

```css
.glass-card {
  background: color-mix(in oklch, var(--card) 70%, transparent);
  backdrop-filter: blur(12px) contrast(2) brightness(0.8);
}
:global(.dark) .glass-card,
.dark .glass-card {
  backdrop-filter: blur(12px) contrast(0.8) brightness(1.2);
}
```

**规则**：任何使用 `backdrop-blur` 的元素，都必须按此搭配写明 contrast/brightness，不允许裸用 `backdrop-filter: blur(...)`。`blur` 半径可调（8-16px），但 contrast/brightness 数值是固定的。
