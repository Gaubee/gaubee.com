# cdn-media Capability Delta

## ADDED Requirements

### Requirement: 媒体路径契约

系统必须（SHALL）让 markdown 与生成产物中的媒体一律写相对路径 `/cdn-media/<source>/<key>`，永不绑定存储域名。
默认 mediaBase 为同源（static-server 内建 cdn-base，SSG 首屏相对路径原生可用）；渲染
action 仅在 geo 规则返回外部 base 时重写 src/poster/source[src]/href 四类属性。

#### Scenario: 首屏无 JS 直出

- WHEN 浏览器禁用 JS 直接打开任一归档 event 的 SSG HTML
- THEN 所有 `/cdn-media/...` 媒体由同源 static-server 正常返回（hydration 前 0 404）

#### Scenario: geo 切换外部 base

- WHEN `/api/geo` 对当前访问者返回外部 mediaBase（如 ESA 域）
- THEN 渲染 action 将页面内 src/poster/source[src]/href 四类媒体引用重写为该 base，且幂等

#### Scenario: geo 失败回退

- WHEN `/api/geo` 请求失败或无匹配规则
- THEN 页面媒体保持同源相对路径不重写，功能不受影响

### Requirement: cdn-base 有界拉穿缓存

static-server 必须（SHALL）以独立子路由提供 `/cdn-media/*`：水位 LRU（high 500MB / low 300MB）、
stream-through 落盘、Range 分层、源 failover；缓存目录为宿主 bind mount（UID 65532
可写），重启后缓存可恢复。

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

### Requirement: GitHub Releases 分卷兜底源

媒体必须（SHALL）以未压缩 USTAR 按月分卷（≤200MB）挂媒体仓库 Releases（append-only）；清单
`manifest/manifest-<gen>.json` 与指针 `manifest/current.json` 放仓库 main 分支，由一次
git commit 原子发布；cdn-base 按「current → gen manifest → 卷 asset id」解析，失败保
last-known-good。

#### Scenario: 空环境全量恢复

- WHEN 在空目录按 manifest 拉取全部卷并解包
- THEN 恢复出的全部文件逐一通过 sha256 校验（初始 3413 文件）

#### Scenario: 指针原子换代

- WHEN 新补丁卷上传后指针 commit 推送
- THEN 读者要么看到旧 gen 要么看到新 gen，不存在指向缺失 asset 的中间态；解析失败时
  cdn-base 沿用 last-known-good 继续服务

### Requirement: 地区路由配置

`/api/geo`（CF Workers + Hono）必须（SHALL）按 IP→地区→mediaBase 规则返回基础域；写接口以
Bearer GitHub token 验证 /user 与 owner 匹配；规则存单写入器 Durable Object（binding
`GEO_RULES_DO`、类 `GeoRulesDO`、实例 `idFromName("geo-rules")`、wrangler.toml migrations
tag v1 用 `new_sqlite_classes`）；DO binding 缺失/不可达/无状态/损坏时回退内置默认规则
（A8 同源，读路径不 500）。

#### Scenario: owner 更新规则

- WHEN 持有效 GitHub token 且 login 与 owner 匹配的请求写规则
- THEN DO 更新生效（版本单调：首写任意正整数，其后必须 current+1，冲突 409 带 currentVersion）且留下审计记录

#### Scenario: 非 owner 写入

- WHEN 非 owner 或无 token 的写请求
- THEN 403，无副作用

### Requirement: 媒体管道与主仓摘除

抓取/打包管道必须（SHALL）改为 staging → Releases 分卷 → git 指针换代 → 才生成日报；媒体二进制
不再进主仓 git；切换顺序：新源+302 兼容路由 → 重渲染 → 切管道 → 摘除旧目录。

#### Scenario: 旧路径兼容

- WHEN 迁移后请求旧 `/x-media/*` 路径
- THEN 302 临时重定向到对应 `/cdn-media/x/*`（一个版本周期后移除）

#### Scenario: 主仓无媒体

- WHEN Phase 3 完成后构建主仓 Docker 镜像
- THEN 镜像不含 x-media 二进制，体积回落至 ≤100MB 量级，CI 构建绿
