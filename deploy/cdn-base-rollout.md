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

## 1. Worker 部署（KV 先于 deploy，顺序不可换）

```sh
cd worker
# 1) 创建生产 KV，把输出的 id 填进 wrangler.toml 两处 PLACEHOLDER_CREATE_BEFORE_DEPLOY
npx wrangler kv namespace create GEO_RULES --env production
# 2) （可选）本地先演练：npx wrangler dev 后 curl localhost:8787/api/geo
# 3) 部署（CI deploy-worker.yml 也会在 push worker/** 时自动做；手动等价命令：）
npx wrangler deploy --env production
```

- `OWNER_LOGIN` 已在 wrangler.toml（= gaubee，非敏感 var）；secrets 不变。
- ★ wrangler.toml 的 KV id 占位符没换成真实 id 之前，**不要合入 main**（CI 会 deploy 失败）。

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

```sh
# 1) 默认回退（未写 KV）：期望 {"mediaBase":"","ruleVersion":0}
curl -s https://gaubee.com/api/geo

# 2) 非匿名读原始规则：期望 401（无 token）/ 403（非 owner）
curl -s -X PUT https://gaubee.com/api/geo/rules -H 'Content-Type: application/json' -d '{}'

# 3) owner 写入一条自定义规则（先用测试域验证改写链路）：
curl -s -X PUT https://gaubee.com/api/geo/rules \
  -H "Authorization: Bearer $GH_TOKEN" -H 'Content-Type: application/json' \
  -d '{"version":1,"rules":[{"match":{"default":true},"mediaBase":"https://cdn-media.gaubee.com"}]}'
# 期望 {"ok":true,"ruleVersion":1}；wrangler tail 里可见 {"audit":"geo_rules.write",...}

# 4) 60s 内公读反映新规则（CF 边缘 + 前端 sessionStorage 各有短缓存）：
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
pnpm build && (pnpm exec vite preview --host 127.0.0.1 &)
cd worker && npx wrangler dev   # 另开终端
PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 pnpm exec playwright test tests/media-geo.e2e.ts
# 三用例：worker 不可达（关掉 wrangler dev 单跑该文件）、默认规则、自定义 base 重写
```

