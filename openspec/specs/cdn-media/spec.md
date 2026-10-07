# Spec: cdn-media（媒体分发架构）

统一媒体命名空间与可插拔分发层。X 转存媒体与站点自有图片统一管理。
目标形态：**完全私有化（本地运行）与拆分部署（服务器+边缘+多源）使用同一程序、
同一配置 schema，仅参数不同**（2026-10-06 kzf 架构裁决）。

> 本 spec 已吸收 change `cdn-media-bootstrap` 的正式 delta（2026-10-07 archive 应用）：
> 各节的「Requirement: …」SHALL 语句与 Scenario 为该 change 评审通过原文；
> 节内其余细则为运行时契约的完整展开。来源 delta 冻结于
> `openspec/changes/archive/2026-10-07-cdn-media-bootstrap/specs/`。

## Requirements

### R1 路径契约（唯一不变量）

**Requirement: 媒体路径契约** — 系统必须（SHALL）让 markdown 与生成产物中的媒体一律写相对路径
`/cdn-media/<source>/<key>`，永不绑定存储域名。默认 mediaBase 为同源（static-server 内建
cdn-base，SSG 首屏相对路径原生可用）；渲染 action 仅在 geo 规则返回外部 base 时重写
src/poster/source[src]/href 四类属性。

#### Scenario: 首屏无 JS 直出

- WHEN 浏览器禁用 JS 直接打开任一归档 event 的 SSG HTML
- THEN 所有 `/cdn-media/...` 媒体由同源 static-server 正常返回（hydration 前 0 404）

#### Scenario: geo 切换外部 base

- WHEN `/api/geo` 对当前访问者返回外部 mediaBase（如 ESA 域）
- THEN 渲染 action 将页面内 src/poster/source[src]/href 四类媒体引用重写为该 base，且幂等

#### Scenario: geo 失败回退

- WHEN `/api/geo` 请求失败或无匹配规则
- THEN 页面媒体保持同源相对路径不重写，功能不受影响

细则：

- markdown / 生成产物中媒体一律写 `/cdn-media/<source>/<key>`（`x/` `site/` `misc/`），
  **永不绑定任何存储域名**。
- 存量 `/x-media/YYYY-MM/...` 平移为 `/cdn-media/x/YYYY-MM/...`（生成器改前缀 + 全量重渲染，
  迁移日一次性完成）。

### R2 四层拓扑（各层可插拔）

```
引用层（相对路径契约）
边缘层（ESA/CF，可插拔，仅加速不改数据）
枢纽层（cdn-base：自托管 bounded pull-through 缓存）
源层（GitHub Releases 持久兜底 / R2 可选加速源 / X live 可选 / 本地盘）
```

- 对外只暴露 `cdn-media.gaubee.com` 一个域；`cdn-base.gaubee.com` 仅作回源目标不对外。
- 无 ESA / 无 R2 时整站可用：读者 → 服务器 cdn-base → GitHub Releases 回源（服务器侧跨境，
  读者不受 GitHub 被墙影响）。

### R3 cdn-base（static-server 内建模块，不新建服务）

**Requirement: cdn-base 有界拉穿缓存** — static-server 必须（SHALL）以独立子路由提供
`/cdn-media/*`：水位 LRU（high 500MB / low 300MB）、stream-through 落盘、Range 分层、
源 failover；缓存目录为宿主 bind mount（UID 65532 可写），重启后缓存可恢复。

#### Scenario: 冷未命中回源落盘

- WHEN 请求的对象不在本地缓存
- THEN 从源顺序拉取（GitHub Releases 优先），流式回给客户端同时 tee 落盘，完成后原子
  rename 入缓存；对象 sha256 校验失败则不入缓存并标记 poisoned

#### Scenario: 水位逐出

- WHEN 缓存总量超过 high 水位
- THEN 按 LRU 逐出至 low 水位；pinned key 不逐出但计入总量，pinned 超过高水位时启动失败

#### Scenario: Range 语义

- WHEN 客户端携带 Range 请求已缓存对象
- THEN 返回 206 与正确 Content-Range；越界返回 416；响应禁用压缩传输且携带
  `Cache-Control: public, max-age=31536000, immutable`

#### Scenario: admin 端口隔离

- WHEN 从公网 8080 扫描 `/cdn-media-admin/*` 路径
- THEN 返回 404；admin/warm 仅存在于宿主 `127.0.0.1:8081` 发布的独立 listener

细则：

- bounded pull-through：high 500MB / low 300MB 水位，超 high 按 LRU 逐出到 low。
- stream-through：回源时 tee 临时文件流式回客户端，收满即 sha256 终验、原子 rename 入缓存；
  **校验通过前回源响应发 `cache-control: no-store`**（不承诺 immutable，r5 裁决），命中/
  严格模式才 immutable；`strict_integrity`（默认关，缓冲上限 128MB）为先缓冲校验再伺服。
- admission 原子预留：投影预算（total+inflight+incoming ≤ high）在锁内一步检查+逐出+预留，
  成功转正/失败 Drop 归还——并发 miss 不可能同时过检查；warm 复用同一 admission/
  single-flight/allow 过滤，预算 min(max_bytes, high)；逐出以文件删除成功为准摘账，
  失败标 undiscardable 拒绝腾位。
- **缓存卷持久化**：`MEDIA_CACHE_DIR` 独立于只读 SERVER_ROOT；容器以可写卷挂载（UID 65532
  可写）；启动校验目录/剩余空间/水位；重启后缓存与 LRU 顺序可恢复。
- 不可变内容：无过期/无 revalidation，缓存生命周期只有 LRU 逐出。
- **LRU 记账**：命中节流更新文件 mtime + 进程内锁保护配额与逐出（禁 atime）。
- Range 分层：常规文件（≤配置阈值，默认 50MB）整文件缓存后本地伺服 Range；
  超阈值文件回源 206 透传不落盘；**pin 按 canonical media key**（非按卷），计入总容量，
  pinned 超过高水位时启动失败而非静默突破预算。
- **HTTP 语义完备**：`/cdn-media/*` 子路由**绕过全局压缩层与通用 no-cache 头**（独立
  middleware）；HEAD/200/206/416、Content-Range、Accept-Ranges、Content-Type、
  `Cache-Control: public, max-age=31536000, immutable`；路径安全：拒绝 `..`、反斜杠、未知 source。
- **完整性语义**：入缓存必校验对象 sha256，失败不入缓存并标 poisoned（下次重取）；
  透传边传边 hash，失败标 poisoned（响应头无缓存承诺，重试即得正确副本）；严格模式
  （先缓冲校验）默认关闭，缓冲上限 128MB。
- **admin/warm 安全边界**：容器内独立 listener `0.0.0.0:8081`，compose 仅发布宿主
  `127.0.0.1:8081`（外网不可达；公网 8080 扫描 admin 路径必须 404）；源 URL 白名单；
  预热限 key/并发/速率/总量。
- **配置 schema 冻结**：`static-server/config.example.toml`（版本化 + 启动强校验；manifest/
  源/缓存/水位/pin/admin/mediaBase/geo 全字段），本地与生产同 schema 实例化；配置经
  compose 只读挂载，不进 scratch 镜像。
- 源适配器按序 failover + 超时熔断；源列表与优先级来自配置。
- 与静态服务同二进制：本地模式 `sources=[GitHub, X]` + 本地缓存目录；
  生产模式同配置 + ESA 前置回源。

### R4 GitHub Releases 源（持久兜底，数据主权）

**Requirement: GitHub Releases 分卷兜底源** — 媒体必须（SHALL）以未压缩 USTAR 按月分卷
（≤200MB）挂媒体仓库 Releases（append-only）；清单 `manifest/manifest-<gen>.json` 与指针
`manifest/current.json` 放仓库 main 分支，由一次 git commit 原子发布；cdn-base 按
「current → gen manifest → 卷 asset id」解析，失败保 last-known-good。

#### Scenario: 空环境全量恢复

- WHEN 在空目录按 manifest 拉取全部卷并解包
- THEN 恢复出的全部文件逐一通过 sha256 校验（初始 3413 文件）

#### Scenario: 指针原子换代

- WHEN 新补丁卷上传后指针 commit 推送
- THEN 读者要么看到旧 gen 要么看到新 gen，不存在指向缺失 asset 的中间态；解析失败时
  cdn-base 沿用 last-known-good 继续服务

细则：

- 独立 public 媒体仓库（不进主仓库 releases）。
- **卷格式冻结**：未压缩 USTAR、512 字节块对齐（禁 gzip——Range 无法定位压缩成员）；
  manifest 记数据起始 offset、UTF-8 固定路径编码；manifest 字段含 format_version、
  archive sha256、asset id/URL、content-type、volume/offset/size/sha256、width/height/
  duration_ms（打包时 ffprobe，不可得则省略）。打包前 asset 数量预检（≤1000/release）。
- **指针机制（git 单次切换）**：卷=不可变 release assets；`manifest/manifest-<gen>.json`
  与 `manifest/current.json`（gen、manifest_sha256、卷 asset id 清单）放媒体仓库 main 分支，
  一次 commit/push 原子上链；回滚=git revert；gen 保留 10 代。
- **cdn-base 解析**：raw 主分支 current.json（短 TTL+ETag，无 API 限额）→ sha256 校验 →
  manifest-<gen>.json raw URL（长缓存）→ 解析+校验通过才原子替换内存索引，失败保
  last-known-good。卷 URL 一律用 asset id（API URL），不按 tag+文件名拼。
  archive sha256 只在打包端校验；cdn-base 冷启动只校验 manifest 与单对象 sha256，不重下全卷。
- 硬约束（r1 复核裁决）：每 release ≤1000 assets——**按对象直传不可行**（存量 3413 文件，
  2026-10 单月 1680 个），tar 分卷是主方案。
- 初始打包：存量 3.3GB 按月分卷（≤200MB/卷）一次性上传，**append-only 永不改写**
  （实际发布 gen-2：105 卷/3426 对象）。
- 增量：cron 新媒体传当月补丁卷 `patch-<date>.tar`（O(新增)）+ git 指针换代。

### R5 地区路由与后台配置

**Requirement: 地区路由配置** — `/api/geo`（CF Workers + Hono）必须（SHALL）按 IP→地区→
mediaBase 规则返回基础域；写接口以 Bearer GitHub token 验证 /user 与 owner 匹配；规则存
单写入器 Durable Object（binding `GEO_RULES_DO`、类 `GeoRulesDO`、实例
`idFromName("geo-rules")`、wrangler.toml migrations tag v1 用 `new_sqlite_classes`）；
DO binding 缺失/不可达/无状态/损坏时回退内置默认规则（A8 同源，读路径不 500）。

#### Scenario: owner 更新规则

- WHEN 持有效 GitHub token 且 login 与 owner 匹配的请求写规则
- THEN DO 更新生效（版本单调：首写任意正整数，其后必须 current+1，冲突 409 带 currentVersion）且留下审计记录

#### Scenario: 非 owner 写入

- WHEN 非 owner 或无 token 的写请求
- THEN 403，无副作用

细则：

- `/api/geo`：按 IP→地区→返回 mediaBase 规则，后台可配（复用既有后台基础）；
  灰度/降级（某源降权、全球切回自托管）= 改规则，不碰 DNS。
- **鉴权模型（r1 复核裁决）**：GET /api/geo 公读；写接口独立鉴权——`Authorization: Bearer
  <GitHub token>` → 调 GitHub /user → login 与配置 owner 匹配（前端 OAuth cookie 无 worker
  session，不复用）；严格 CORS、限流、审计；Worker 单测 + 部署后真实请求验收。
- **规则存储（r10 复核裁决：单写入器 Durable Object，替代 KV——KV 无 compare-and-swap，
  并发 owner 写会双双读到同代后写覆盖）**：binding `GEO_RULES_DO` / 类 `GeoRulesDO` /
  实例 `idFromName("geo-rules")`，binding 进 wrangler.toml（dev/prod，per-env 重申），
  `[[migrations]]` tag v1 用 `new_sqlite_classes`（free plan 拒绝 `new_classes`，API 10097
  实证，部署收据见 deploy/cdn-base-rollout.md）；版本单调判定收敛进 DO 串行执行
  （首写任意正整数，其后必须 current+1，重复/回退/跳跃 409 带 currentVersion）；
  DO 故障回退语义：binding 缺失/不可达/无状态/损坏 → 内置默认规则（A8 同源，读路径
  绝不 500），写路径 DO 失败 502、校验拒绝 400 原样透传。
- 渲染 action 从 geo 结果取 base；本地私有化 `mediaBase` 指向 localhost 同拓扑。
- **引用覆盖**：action 必须重写 src / poster / source[src] / href 全部属性
  （r1 实测 /x-media/ 引用 4510 处），幂等 + MutationObserver + geo 失败回退默认 base。

### R6 媒体管道与体积红线

**Requirement: 媒体管道与主仓摘除** — 抓取/打包管道必须（SHALL）改为 staging → Releases
分卷 → git 指针换代 → 才生成日报；媒体二进制不再进主仓 git；切换顺序：新源+302 兼容路由 →
重渲染 → 切管道 → 摘除旧目录。

#### Scenario: 旧路径兼容

- WHEN 迁移后请求旧 `/x-media/*` 路径
- THEN 302 临时重定向到对应 `/cdn-media/x/*`（一个版本周期后移除）

#### Scenario: 主仓无媒体

- WHEN Phase 3 完成后构建主仓 Docker 镜像
- THEN 镜像不含 x-media 二进制，体积回落至 ≤100MB 量级，CI 构建绿

细则：

- 抓取管道改为：下载 staging → 推 GitHub Releases（R2 接入后双写）→ 才允许生成日报；
  日报前置硬门 = `x-media-audit --require-packed` 退出 0（零待打包/断链/孤儿）。
- staging 保留期清理唯一执行者 = `cdn-media/tools/staging-clean.ts`（dry-run 默认；
  四安全条件：已入 manifest/卷已发布/mtime>7 天/位于 staging/x 下），协议见 SKILL.md。
- 媒体不再进主仓库 git 提交；存量 `static/x-media` 已摘除（git rm --cached + dockerignore，
  2026-10-07 提交 877ad11a），git 历史重写为可选后续。
- cron 的体积红线检查改为检查缓存水位（cache.rs high 500MB/low 300MB）与远端用量。

## Shutdown（非目标）

- ESA / R2 接入是控制台操作 + 配置行，不是代码变更。
- X live 源默认关闭（境内不可达），仅海外场景可选启用。
- 不自研在线分块随机访问（分卷仅灾备形态，在线服务走整文件）。
