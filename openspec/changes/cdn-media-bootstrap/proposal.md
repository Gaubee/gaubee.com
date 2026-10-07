# Change: cdn-media 媒体分发架构落地（Phase 0-3）

## Why

media 现状 3.3GB / 3413 文件全部压在 git 与 Docker 镜像里：clone/CI 慢（构建 56 分钟）、
镜像与媒体耦合导致 watchtower 覆盖 `/srv` 的隐患、媒体无法多源分发。
kzf 于 2026-10-06 确定架构（specs/cdn-media/spec.md）：路径契约 `/cdn-media/<source>/` +
自托管 bounded pull-through 缓存（cdn-base，并入 static-server）+ GitHub Releases 持久兜底，
R2/ESA 后续作为可插拔性能件接入。**Phase 0-3 完成后，不配置 R2/ESA 整站即可正常使用。**

## What Changes

- **Phase 0 打包引导**：`cdn-media/tools/media-pack.ts`（子仓工具，主仓编排）——存量按月
  分卷（≤200MB 未压缩 USTAR）+ 补丁卷 + 不可变 generation manifest（media-index release，
  current 指针原子换代）+ `gh release upload`（初始 ~17 卷）+ 空目录恢复演练。
- **Phase 1 cdn-base 模块**：static-server（Rust）新增 `/cdn-media/*` 子路由（独立 middleware：
  绕过全局压缩层、immutable 缓存头、完整 Range 语义）——水位 LRU（500/300MB）、
  stream-through 落盘、Range 分层（≤50MB 整存，超限透传+按 key 钉住）、GitHub 源适配器
  （manifest generation 协议）+ failover/熔断 + loopback admin 端口的预热接口 + 持久缓存卷。
- **Phase 2 引用与路由**：渲染 action 重写 src/poster/source[src]/href 四类属性 →
  geo 指定的外部 mediaBase（默认同源不重写）；worker `/api/geo`（Bearer GitHub owner 鉴权 +
  规则存单写入器 Durable Object `GEO_RULES_DO`/`GeoRulesDO`，r10 起，部署收据确认生产
  KV 零状态无迁移）+ 后台配置页；本地/生产同 schema 配置文件。
- **Phase 3 管道切换与摘除**：生成器前缀 `/x-media/` → `/cdn-media/x/` + 全量重渲染；
  迁移矩阵全量脚本（fetch/backfill/posters/audit/audit-fix/media-meta）切 staging+manifest；
  主仓库 `git rm -r --cached static/x-media` + ignore/dockerignore；
  旧 `/x-media/*` 路径 **302**（临时重定向，可撤）兜底一个版本周期；cron prompt 红线改为缓存水位。
  切换顺序（r1 复核裁决）：先部署新源与兼容路由 → 再重渲染 → 再切管道 → 最后摘除旧目录。
- **Phase 4（可选，控制台操作）**：R2 源接入（rclone 全量 + 优先级表加行）、ESA 域名接入。

## Impact

- 代码：static-server/src（cdn-base 模块 + 双 listener）、`src/lib/player/` 渲染 action、
  `cdn-media/tools/media-pack.ts`（子仓，主仓编排调用）、`skills/gaubee-skills/scripts/`
  （抓取/审计/元数据管道迁移矩阵）、生成器前缀、
  新建 public 媒体仓库（Releases 载体）。
- 内容：1299 个 x-archive event 重渲染（前缀迁移）。
- 运维：镜像瘦身 3.3GB → 数十 MB；watchtower 可安全上线；CI 构建时间回落。

## 验收门

- [ ] Phase 0：manifest 与卷可从空环境完整恢复全量媒体（拉清单→拉卷→对账 sha256）。
- [ ] Phase 1：cdn-base 单元测试（水位/LRU/Range/failover）+ 本地端到端（serve→miss→hit→逐出）。
- [ ] Phase 2：浏览器实机走查 base 重写与 geo 路由；本地私有化模式跑通。
- [ ] Phase 3：线上无 R2/ESA 形态全站可用；镜像体积回落数十 MB 量级；CI 绿。
