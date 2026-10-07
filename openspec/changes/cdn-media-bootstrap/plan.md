# 详细工作规划 v3：cdn-media-bootstrap（Codex 复核 r2 6.8/10 → 修订）

> r1 4.5 → r2 6.8。r2 关闭了架构层问题，残余集中在「机制未定义到可实现」。本版逐一落死。

## 技术选型（已裁决）

cdn-base 并入 static-server（Rust/axum）；边缘 API 延续 CF Workers+Hono；打包工具
Bun/TS 归属 **cdn-media 子仓 `tools/`**（主仓编排，子仓提交同步 gitlink）。

## Stage A 契约冻结

| # | 契约 | 内容（v3 增补处标 ★） |
|---|------|------|
| A1 | tar 卷格式 | 未压缩 USTAR、512 字节块；数据起始 offset；UTF-8 固定路径编码（禁 `..`/反斜杠）；manifest 字段：format_version、archive sha256、asset id/URL、content-type、volume/offset/size/sha256 ★**+ width/height/duration_ms（打包时 ffprobe 产出；不可得则省略，生成器回退无尺寸输出）**；★打包前 asset 数量预检（≤1000/release） |
| A2 | ★manifest 发布机制（v4 定死：git 指针） | **指针与清单放 cdn-media 仓库 main 分支（git commit 天然单次切换），卷仍挂 Releases（不可变 asset）**。`manifest/manifest-<gen>.json`（按约定永不重写）+ `manifest/current.json`（`{gen, manifest_sha256, volumes:[{asset_id,url,sha256}]}`）。发布状态机：传卷 asset→记 asset id→校验→**一次 git commit/push**（新增 manifest-<gen>.json + 更新 current.json）；回滚=git revert；gen 保留 N=10 代。cdn-base 解析：raw.githubusercontent 主分支 `current.json`（短 TTL+ETag，**无 API 限额**）→ 校验 sha256 → 取 `manifest-<gen>.json` raw URL（长缓存）→ 解析+sha256 通过才原子替换内存索引，失败保 last-known-good。**卷 URL 用 asset id（API URL），不按 tag+文件名拼**（防 tag/asset 误改毁长缓存）。archive sha256 只在打包端校验；cdn-base 冷启动只校验 manifest+单对象，不重下全卷 |
| A3 | ★缓存卷落地机制（v4 修正） | 采用 **bind mount**（现状澄清：镜像仅 Dockerfile `USER 65532:65532`，compose 无 user/env_file）。部署文档（写入 1Panel 步骤）：宿主目录绝对路径（如 `/opt/gaubee/media-cache`）预创建 + `chown 65532:65532`；compose 挂载为容器内 `MEDIA_CACHE_DIR=/media-cache`；启动校验：可写探针文件、剩余空间 ≥ high×1.2、水位合法，任何失败**启动即败**（日志给修复指令）；磁盘满行为：拒绝入缓存仅透传（服务不中断）；升级迁移：目录 self-describing（key 即路径） |
| A4 | 媒体 HTTP 语义 | ★**middleware 拆分**：/cdn-media/* 子路由**绕过全局 CompressionLayer**（现 main.rs:49 全局启用）+ **不继承**通用 no-cache 头（现 main.rs:129），独立写入 `Cache-Control: public, max-age=31536000, immutable`、Accept-Ranges、Content-Range、Content-Length、Content-Type；验收：curl -I 含 Accept-Encoding 实测无压缩 + 200/206/416 全矩阵 |
| A5 | ★admin 隔离（v4 修正拓扑） | 容器内监听 **0.0.0.0:8081**（第二 listener），compose **只发布到宿主 loopback**：`127.0.0.1:8081:8081`——外网不可达，1Panel/宿主脚本经宿主 loopback 调用（scratch 无 shell，不能 docker exec）；公网 8080 扫描 `/cdn-media-admin/*` 必须 404（验收项）；反代拒绝转发 8081；源 URL 白名单 + 预热限 key/并发/速率/总量 |
| A6 | worker 鉴权 | GET /api/geo 公读；写接口 Bearer GH token → /user → owner 匹配；规则存单写入器 Durable Object：binding `GEO_RULES_DO`（类 `GeoRulesDO`，实例 `idFromName("geo-rules")`，migrations tag v1 用 `new_sqlite_classes`，free plan 拒绝 `new_classes`）进 wrangler.toml（dev/prod）+ 严格 CORS + 限流 + 审计 + 规则 schema + DO 故障回退默认规则（A8） |
| A7 | 域名拓扑 | cdn-media.gaubee.com → 反代 Host 路由 → static-server `/cdn-media/*`；DNS/TLS/健康检查/默认 mediaBase；外网全链路验收 |
| A8 | ★默认 base=同源（定死） | SSG 首屏 HTML 即带 `/cdn-media/...` 相对路径，**static-server 本身就内建 cdn-base**，同源路径原生可用（hydration 前 0 404）。`use:media-src` 仅在 geo 规则返回外部 base（如 ESA 域）时才重写；geo 失败/无规则 = 不重写。兼容重定向 `/x-media/*` → 302 |
| A9 | ★配置 schema（冻结产物） | `static-server/config.example.toml`（版本化 + 启动强校验）：manifest endpoint/generation、GitHub repo、source allowlist+优先级、cache dir/high/low/threshold、pinned keys、admin listener/token、默认 mediaBase、geo 预留段（`rules`/`kv_namespace` 仅解析不读的冻结 schema 字段；规则权威存储在 worker 侧 `GEO_RULES_DO` 单写入器，不经 static-server 配置）。本地与生产同 schema 实例化，env 覆盖规则写明。★**配置不进 scratch 镜像**：compose 只读 bind mount 挂载 config.toml；文件缺失/字段非法启动即败 |

## Phase 0 打包引导（含恢复演练）

0.1 `cdn-media/tools/media-pack.ts`（initial/patch/index 三模式）：按月 ≤200MB USTAR 卷 + manifest（A1 含 w/h/ms）+ asset 预检 + staging 清理 + 断点重试。0.2 初始上传 + A2 状态机；验收=**空目录恢复演练**（拉 current→拉 manifest→拉卷→恢复 3413 文件逐一 sha256）。0.3 增量 patch；验收=连续两日对账一致 + 中途崩溃可重入。

## Phase 1 cdn-base（Rust）

1.1 handler（A4 子路由 middleware 拆分）+ 路径安全；1.2 GitHub 源适配器（A2 解析算法）；1.3 bounded LRU（mtime 节流 + 锁，重启恢复，并发 miss 去重，临时文件清理）；1.4 Range 分层（≤50MB 整存；超限透传）；★**完整性语义**：入缓存必校验对象 sha256，失败不入缓存并标 poisoned（下次重取）；透传流边传边 hash，失败标 poisoned 响应已出（header 无缓存承诺，客户端重试即得正确副本）；严格模式（先缓冲全量校验再回）**默认关闭**，缓冲上限 128MB |；1.5 admin/warm（A5 宿主 loopback 发布）；1.6 缓存卷部署（A3）；1.7 双 listener 骨架改造；1.8 测试门：单测 + 端到端（miss→hit→重启→逐出→透传→Range/416→无压缩→公网 404 admin）+ CI cargo gate。

## Phase 2 引用与路由

2.1 `use:media-src`：src/poster/source[src]/href 全覆盖（4510 处实测分布）；幂等 + MutationObserver + geo 失败不重写（A8 默认同源）；挂 EventBody 与文章详情；2.2 worker /api/geo（A6 + 单测 + 部署后真实请求验收）；2.3 后台配置页；2.4 本地私有化同拓扑验收；2.5 公网域名（A7）+ 无 R2/ESA 外网全链路验收（图片/封面/播放/灯箱）。

## Phase 3 切换与摘除（顺序不可换）

3.1 部署 cdn-base + 302 兼容路由；3.2 生成器前缀迁移 → 重渲染 → shadow 对账；3.3 ★**迁移矩阵（r2 补全）**：x-likes-fetch、x-media-backfill、x-posters、**x-media-audit-fix、x-media-audit（旧 100MB 门禁一并废除）**、media-meta（输入改 manifest——A1 已带 w/h/ms，本地不再需要视频文件）；★**冻结 x.json `mediaLocal` 语义 = canonical media key**（不再兼任 staging 路径）；staging 保留期=发布校验通过后 7 天清理；3.4 cron prompt 换水位；3.5 摘 `static/x-media`；3.6 验收：全站可用、镜像 ≤100MB、CI 绿、git 历史重写列为可选后续。

## 翻车点自查清单

poster/href 漏改；Content-Range 错；压缩层残留；容器缓存不可写；manifest current 窗口 404；摘目录后生成器丢尺寸；/api/geo 生产 DO 无规则（回退默认同源，A8——部署收据确认生产 KV 本就零状态）；admin 端口暴露公网；透传损坏数据入缓存。
