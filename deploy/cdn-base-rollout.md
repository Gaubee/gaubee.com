# cdn-base 上线部署顺序（存量服务器，2026-10-06 起生效）

> 适用前提：镜像 tag ≥ 含 cdn-base 模块的构建（`4efd84d3` 起）。新二进制把
> `config.toml` 作为启动硬依赖（缺失/非法**启动即败**，fail-fast 是契约 A9），
> 因此必须先完成本清单再拉新镜像。Watchtower 自动更新在完成本清单并验证前保持关闭。

## 前置一次性准备（服务器上）

```sh
# 1. 配置文件（从仓库样例拷贝后按需修改；不要把 token 写进文件，用 env 注入）
sudo mkdir -p /opt/gaubee
sudo cp /path/to/repo/static-server/config.example.toml /opt/gaubee/config.toml
# 2. 缓存目录：镜像以 UID 65532 运行（scratch 无 shell 不能 exec chown，必须宿主预置）
sudo mkdir -p /opt/gaubee/media-cache
sudo chown -R 65532:65532 /opt/gaubee/media-cache
# 3. 剩余空间 ≥ high×1.2（high 默认 500MB，即 ≥600MB）
df -h /opt/gaubee/media-cache
```

## compose 变更点（对照仓库 docker-compose.yml）

- `volumes:` 追加 `/opt/gaubee/config.toml:/config.toml:ro`（只读挂载，不进镜像）
- `volumes:` 追加 `/opt/gaubee/media-cache:/media-cache`（bind mount，缓存持久化）
- `ports:` 追加 `127.0.0.1:8081:8081`（admin 仅宿主 loopback 可达；**公网反代拒绝转发 8081**）

## 验证顺序（每步通过再下一步）

1. `docker compose config` —— 确认 config 是文件挂载、缓存是 bind mount、8081 只绑 loopback
2. `docker compose pull && docker compose up -d` —— 启动失败时看日志修复指令
   （常见：config 缺字段 / 缓存目录不可写 / 剩余空间不足）
3. `curl localhost:8080/healthz` → 200；`curl localhost:8081/cdn-media-admin/stats` → JSON
4. `curl -o /dev/null -w '%{http_code}' localhost:8080/cdn-media-admin/stats` → **404**（公网面隔离）
5. 冷拉一个媒体对象：`curl -H 'Accept-Encoding: gzip' -D - localhost:8080/cdn-media/x/<某对象>` 
   → 200、**无 content-encoding**、`cache-control: public, max-age=31536000, immutable`
6. Range：`curl -r 0-99 -D - -o /dev/null <同 URL>` → 206 + 正确 Content-Range
7. 重启容器 → `stats` 的 objects 不归零（缓存持久化生效）
8. 外层反代把 `cdn-media.gaubee.com` 指到 8080（Host 路由），公网全链路复验 5/6

## 回滚

镜像回退到上一个 digest（`docker compose` 里 pin digest），旧二进制不读 config.toml，
但已挂载的卷无害；config/缓存目录保留，下次升级复用。

## 观察（上线后 24h）

反代日志回源错误率、`stats` 的 `poisoned_active`/`undiscardable`/`inflight_reserved`
三字段（应长期为 0/极少）、磁盘水位（LRU 逐出日志）。

---

# Phase 2 上线节（引用与路由，2026-10-07）

> 前端 `use:mediasrc` + worker `/api/geo` 已落地（openspec R1/R5，A8 默认同源）。
> 语义基线：**geo 失败/无规则/规则 mediaBase 为空串 = 不重写**，SSG 相对路径同源原生可用，
> 所以本节全部步骤都可以在媒体前端无感的前提下灰度推进；只有写入一条非空 mediaBase
> 规则才会开始改写引用，随时可写回空串全球切回同源。

## 1. Worker 部署（规则存储为 Durable Object；生产收据：KV 零状态，无迁移需求，r11 P1-1）

> **部署收据（2026-10-07 依据 deploy-worker.yml 全部 13 次运行核实）——生产从未存在
> GEO_RULES KV，无任何规则数据可迁移**：
> - 成功部署只有 2026-07-24 ～ 2026-08-14 的 7 次（run 30074387592 / 30125697664 /
>   30160940159 / 30199208445 / 30316282876 / 30522909532 / 31786419710），全部早于
>   Phase 2（geo 模块 2026-10-07 才随 70640720 入库）。当前生产 worker（gaubee-auth-production）
>   即 2026-08-14 版本：从未包含任何 geo / KV / DO binding，也从未服务过 /api/geo。
> - 首个含 GEO_RULES KV binding 的提交 70640720（wrangler.toml id 仍是
>   PLACEHOLDER_CREATE_BEFORE_DEPLOY 占位符）部署 FAILED（run 37573789659：npm ci 的
>   Arborist edgesOut bug，未走到 wrangler deploy）；修复尝试 c5c4dd85 也 FAILED
>   （run 37575131668：worker 测试 TSCONFIG_ERROR）。
> - 其后三个提交（7647822b / d85cfcb6 / 456d2c75）workflow 虽绿，但 KV 占位符守卫置
>   SKIP_DEPLOY=1，wrangler deploy 从未执行（run 37575490505 / 37577693434 / 37578421101
>   日志均含「仍含 GEO_RULES KV 占位符…跳过部署」warning）。
> - 综上：**生产 KV 零状态（binding 从未部署、namespace 从未创建、零规则写入），
>   无迁移需求**——不存在「已有规则被 DO 空状态静默顶掉」的发布回退面。
>
> **防御性说明**：若未来在任何环境发现 KV 规则存量（例如某台开发机曾用
> `wrangler kv key put --local` 写入过——那只存在于该机 .wrangler/state，不可能出现在生产），
> 迁移路径是经 owner PUT 逐条写入 DO（首写接受任意正整数版本，其后必须 current+1，
> 见第 3 节版本纪律）；不存在也不计划提供自动 KV→DO 迁移工具。
>
> **DO 部署形态**：规则文档由单写入器 Durable Object（binding `GEO_RULES_DO` /
> 类 `GeoRulesDO`）承载，实例经 `idFromName("geo-rules")` 派生 id，类由 wrangler.toml
> `[[migrations]]`（tag v1，`new_sqlite_classes`）在首次 `wrangler deploy` 时自动创建，
> **无任何手动资源步骤**。free plan 只接受 `new_sqlite_classes`：首个含 DO 的提交
> f03a4507 用 `new_classes` 部署即被 Cloudflare API 拒绝（run 37581484857，错误码 10097
> 「free plan 下必须用 new_sqlite_classes 迁移创建 namespace」），wrangler.toml 已改为
> `new_sqlite_classes`（v1 此前从未成功发布到任何环境，改动不违「账本只增不改」）。
> deploy-worker.yml 的 KV 占位符守卫（skip deploy + regex fixtures）已随 KV binding 一并删除。
> 迁移账本只增不改：后续新增 DO 类必须追加新 tag（v2...），不可重放 v1。

```sh
cd worker
# 1) （可选）本地先演练：npx wrangler dev 后 curl localhost:8787/api/geo
# 2) 部署（CI deploy-worker.yml 也会在 push worker/** 时自动做；手动等价命令：）
npx wrangler deploy --env production   # 首次部署自动应用 migrations（new_sqlite_classes: GeoRulesDO）
```

- `OWNER_LOGIN` 已在 wrangler.toml（= gaubee，非敏感 var）；secrets 不变。

## 2. DNS / 反代

- 站点源站反代（1Panel/nginx 容器那一层）加一条同源 API 路由，让 `gaubee.com/api/*`
  直达 worker（前端 action fetch 的是同源相对路径 `/api/geo`）：

  ```nginx
  location /api/ {
    proxy_pass https://auth.gaubee.com;
    proxy_set_header Host auth.gaubee.com;
    proxy_ssl_server_name on;
  }
  ```

- `cdn-media.gaubee.com` → 8080 Host 路由（Phase 1 第 8 步，不变）。
- 未来接入加速域（ESA 等）：新域同样 CNAME/Host 路由到 8080，规则里 `mediaBase` 填该域——
  灰度/回滚都改规则，不碰 DNS。

## 3. 验收 curl 清单（部署后逐条实跑）

> 版本纪律（r9 P1-2）：规则版本由服务端守护单调——服务端已有规则时 `version` 必须严格等于
> 当前版本 +1，重复/回退/跳跃一律 409（响应带 `currentVersion`）；首次写入接受任意正整数
> （0 与内置默认规则撞代次，拒收）。r10 P1-1 起该判定在单写入器 Durable Object 内串行执行，
> 并发保存不会分叉代次。下面的 curl 示例版本号按首写 1 → 回滚 2 递增；
> 实际操作时先用 `GET /api/geo/rules` 看当前版本再决定下一个版本号。

```sh
# 1) 默认回退（未写规则）：期望 {"mediaBase":"","ruleVersion":0}
curl -s https://gaubee.com/api/geo

# 2) 非匿名读原始规则：期望 401（无 token）/ 403（非 owner）
curl -s -X PUT https://gaubee.com/api/geo/rules -H 'Content-Type: application/json' -d '{}'

# 3) owner 写入一条自定义规则（先用测试域验证改写链路）：
curl -s -X PUT https://gaubee.com/api/geo/rules \
  -H "Authorization: Bearer $GH_TOKEN" -H 'Content-Type: application/json' \
  -d '{"version":1,"rules":[{"match":{"default":true},"mediaBase":"https://cdn-media.gaubee.com"}]}'
# 期望 {"ok":true,"ruleVersion":1}；wrangler tail 里可见 {"audit":"geo_rules.write",...}

# 4) 公读立即反映新规则（/api/geo 为 Cache-Control: private, no-store，不进 CF 边缘/反代等
#    任何共享缓存——地区结果按 cf.country 变化而默认 cache key 不含 country，r9 P1-1；
#    前端 sessionStorage 10min TTL 由保存时的 BroadcastChannel 失效广播兜底，其它 tab 立即重拉）：
curl -s https://gaubee.com/api/geo   # 期望 {"mediaBase":"https://cdn-media.gaubee.com","ruleVersion":1}

# 5) 真实浏览器：打开任一事件详情页（如 /article/events/00478.x-archive-2026-07-25），
#    DevTools 里 /cdn-media/ 引用应被改写为 https://cdn-media.gaubee.com/...；
#    本地私有化场景（无反代、无 worker）同页应保持相对路径且媒体可访问。

# 6) 回滚 = 写回空串（全球切回同源，等价 Phase 2 之前）：
curl -s -X PUT https://gaubee.com/api/geo/rules \
  -H "Authorization: Bearer $GH_TOKEN" -H 'Content-Type: application/json' \
  -d '{"version":2,"rules":[{"match":{"default":true},"mediaBase":""}]}'
```

## 4. 本地私有化验收（同一程序、仅参数不同）

```sh
export GH_TOKEN="$(gh auth token)"   # 自定义 base 场景经 owner PUT 种规则（真实 Bearer→GitHub /user→owner 鉴权链路）
pnpm build && (pnpm exec vite preview --host 127.0.0.1 &)
PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm exec playwright test tests/media-geo.e2e.ts
# 三场景：worker 不可达（先在 wrangler dev 未启动时跑一轮，再补下面两场景）、默认规则、自定义 base 重写。
# wrangler dev 由测试按需拉起（--persist-to 一次性临时目录，DO 空状态，默认规则场景依赖它），
# 结束后测试自动回收进程并清理目录；也可手动 `cd worker && npx wrangler dev` 预先启动复用
#（此时默认规则场景要求该实例的 DO 处于空状态，否则该场景会报出明确指引并失败）。
```

