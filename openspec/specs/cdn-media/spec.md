# Spec: cdn-media（媒体分发架构）

统一媒体命名空间与可插拔分发层。X 转存媒体与站点自有图片统一管理。
目标形态：**完全私有化（本地运行）与拆分部署（服务器+边缘+多源）使用同一程序、
同一配置 schema，仅参数不同**（2026-10-06 kzf 架构裁决）。

## Requirements

### R1 路径契约（唯一不变量）

- markdown / 生成产物中媒体一律写 `/cdn-media/<source>/<key>`（`x/` `site/` `misc/`），
  **永不绑定任何存储域名**。
- 存量 `/x-media/YYYY-MM/...` 平移为 `/cdn-media/x/YYYY-MM/...`（生成器改前缀 + 全量重渲染，
  迁移日一次性完成）。
- **默认 mediaBase = 同源**（static-server 内建 cdn-base，SSG 首屏相对路径原生可用，
  hydration 前 0 404）；base 重写推迟到渲染时：`use:` action 仅在 geo 规则返回外部 base 时
  重写 src/poster/source[src]/href，geo 失败或无规则 = 不重写。

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
- 初始打包：存量 3.3GB 按月分卷（≤200MB/卷，约 17 卷）一次性上传，**append-only 永不改写**。
- 增量：cron 新媒体传当月补丁卷 `patch-<date>.tar`（O(新增)）+ git 指针换代。

### R5 地区路由与后台配置

- `/api/geo`：按 IP→地区→返回 mediaBase 规则，后台可配（复用既有后台基础）；
  灰度/降级（某源降权、全球切回自托管）= 改规则，不碰 DNS。
- **鉴权模型（r1 复核裁决）**：GET /api/geo 公读；写接口独立鉴权——`Authorization: Bearer
  <GitHub token>` → 调 GitHub /user → login 与配置 owner 匹配（前端 OAuth cookie 无 worker
  session，不复用）；严格 CORS、限流、审计；KV binding 进 wrangler.toml（dev/prod），
  规则 schema + 默认回退；Worker 单测 + 部署后真实请求验收。
- 渲染 action 从 geo 结果取 base；本地私有化 `mediaBase` 指向 localhost 同拓扑。
- **引用覆盖**：action 必须重写 src / poster / source[src] / href 全部属性
  （r1 实测 /x-media/ 引用 4510 处），幂等 + MutationObserver + geo 失败回退默认 base。

### R6 媒体管道与体积红线

- 抓取管道改为：下载 staging → 推 GitHub Releases（R2 接入后双写）→ 才允许生成日报。
- 媒体不再进主仓库 git 提交；存量 `static/x-media` 摘除（git rm --cached + dockerignore），
  git 历史重写为可选后续。
- cron 的 4.5GB 红线检查改为检查缓存水位与远端用量。

## Shutdown（非目标）

- ESA / R2 接入是控制台操作 + 配置行，不是代码变更。
- X live 源默认关闭（境内不可达），仅海外场景可选启用。
- 不自研在线分块随机访问（分卷仅灾备形态，在线服务走整文件）。
