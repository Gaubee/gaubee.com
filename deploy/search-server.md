# search-server 部署手册（SQLite FTS5 + magpie embedding）

> 状态：2026-11-26 重构为方案 A（远程 embedding + 轻量 SQLite 索引）。旧 zvec/ONNX
> 进程内模型已移除；运行镜像不再包含 zvec SDK、ONNX Runtime 与 E5 模型。
> 引擎：SQLite（FTS5 + 暴力余弦扫描，rusqlite bundled）+ magpie 网关
> `mistral-embed`（1024 维；可切换 `text-embedding-3-small` 1536 维）。

## 1. 拓扑

```
浏览器 ──/api/search──> openresty (TLS, 17080)
                             │  proxy_pass 127.0.0.1:17082
                             ▼
                      search-server 容器（network_mode: host，约 110 MB 镜像）
                      POST /api/search, GET /health
                      /data/index.sqlite（SQLite 单文件索引）
                             │
                             └── POST {MAGPIE_URL}/v1/embeddings
```

- 静态站点仍由现有 Rust axum static-server 容器提供；search-server 是**独立容器**。
- 索引是单文件 `/data/index.sqlite`，挂载宿主卷 `/opt/gaubee/search`，容器重建不丢。
- 客户端仍是 `POST /api/search`；超时已调为 1200ms（冷启动 2500ms），
  超时后回退浏览器端 MiniSearch。服务端查询 embedding 超时默认 2s 并降级 FTS。
- 查询 embedding 失败/超时（默认 2s）时服务自动降级为 FTS-only，响应
  `degraded: true`，客户端照常展示 FTS 结果。
- serve 侧 query embedding 有 256 条进程内 LRU（key = 模型 + 查询文本），
  重复查询直接复用向量；`/health` 的 `embedCache*` 暴露条目/命中/未命中。

> **端口说明**：`127.0.0.1:17081` 已被 cdn-media-pointer 的 `python -m http.server`
> 占用。本服务默认 **17082**；若冲突，用 `SEARCH_BIND` 覆盖（host 网络）并同步 openresty。

## 1.1 API 契约

```http
POST /api/search
Content-Type: application/json

{
  "q": "rust 异步",
  "apps": ["event"],          // 可选：限定应用
  "excludeApps": ["articles"],// 可选：排除应用
  "tags": ["rust"],           // 可选：标签（整词匹配）
  "dateFrom": 1704067200000,  // 可选：毫秒时间戳
  "dateTo": 1767225600000,
  "limit": 10,                // 默认 10，最大 50
  "offset": 0,                // 最大 200
  "mode": "hybrid"            // hybrid（默认）/ vector / fts
}
```

响应字段与旧版一致：

```json
{
  "results": [
    {
      "id": "src/content/events/01931.github-daily-2026-11-24.md",
      "appId": "event",
      "appName": "事件",
      "title": "GitHub 日报：2026-11-24",
      "excerpt": "……",
      "href": "/article/events/01931.github-daily-2026-11-24",
      "date": 1763942400000,
      "score": 0.5
    }
  ],
  "total": 55,
  "tookMs": 4,
  "engine": "sqlite-fts5",
  "degraded": false
}
```

- 结果按 `parentId` 去重（同篇取最高分 chunk），`id` 即 parentId。
- `total` 是候选集内去重后的文档数，受 topk 截断，不是全库精确 count。
- `mode=hybrid`：FTS5 BM25 + 向量 cosine 各取 topk，RRF（k=60）融合。
- `mode=vector`：纯向量；embedding 失败时同样降级 FTS-only 并置 `degraded=true`。
- `mode=fts`：不调用 embedding，永不 `degraded`。
- `GET /health` 返回：
  `{ok, engine, embedModel, embedConfigured, embedDim, embedCacheEntries, embedCacheHits, embedCacheMisses, docs, documents, chunks, indexBuiltAt, index, uptimeMs}`。
  `docs` 是 chunk 数（兼容旧字段），`documents` 是去重后的篇数；
  `embedCache*` 是进程内 query embedding LRU 的条目/命中/未命中计数。

## 1.2 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `MAGPIE_URL` | `https://magpie.aiweb.xin` | 网关基础地址；生产用 `http://127.0.0.1:3425`（host 网络） |
| `MAGPIE_API_KEY` | 无 | caller key；**只放 env_file，不进仓库/镜像/日志** |
| `MAGPIE_EMBED_MODEL` | `mistral-embed` | 1024 维；换模型必须重建索引（维度随模型变化） |
| `MAGPIE_TIMEOUT_MS` | `1000` | serve 查询 embedding 超时（毫秒），超时降级 |
| `MAGPIE_QUERY_RETRIES` | `0` | 查询重试次数；默认超时即降级，避免放大客户端超时 |
| `EMBED_BATCH_SIZE` | `48` | 构建期每请求条数；mistral 下 64 条 1600 字符 chunk 会超 token 上限，超限自动二分拆批 |
| `EMBED_CONCURRENCY` | `4` | 构建期并发请求数 |
| `MAGPIE_BUILD_TIMEOUT_MS` | `120000` | 构建期单请求超时 |
| `MAGPIE_MAX_RETRIES` | `5` | 429/5xx/超时重试次数 |
| `INDEX_FILE` | `/data/index.sqlite` | 索引文件 |
| `CONTENT_DIR` | `/app/content` | 镜像内公开内容目录 |
| `BUILD_ON_START` | `1` | 启动时检查/重建索引；`0` 表示只 serve |
| `SEARCH_BIND` | `127.0.0.1:17082` | host 网络下监听宿主 loopback（供 openresty 反代） |
| `RUST_LOG` | `info` | 日志级别 |

## 2. 构建镜像

构建上下文必须是仓库根目录（内容在 `src/content`）：

```bash
cd /path/to/gaubee.com
docker build -f search-server/Dockerfile -t gaubee-search:local .
```

多阶段构建：
1. `rust:1.92-trixie` 编译 `cargo build --release --locked`（rustls，无 OpenSSL 动态依赖）；
2. `debian:trixie-slim` 运行，只复制二进制、`entrypoint.sh`、`src/content` 与 curl。

镜像目标 <150 MB，估算见第 7 节。构建期**不下载** zvec/ONNX/模型，也不需要
`MAGPIE_API_KEY`（索引在容器启动时构建）。

> **镜像拉取通道**：生产服务器直连 `ghcr.io` 的 blob 域名会 TLS 超时，但
> `ghcr.nju.edu.cn` 镜像可正常拉取且 digest 与 ghcr.io 一致；compose 使用
> `ghcr.nju.edu.cn/gaubee/gaubee-search:latest`，CI 仍推 ghcr.io。

## 3. compose service

准备宿主目录与密钥文件：

```bash
sudo mkdir -p /opt/gaubee/search
sudo chown 10001:10001 /opt/gaubee/search   # 容器内 USER search(10001)

sudo install -m 600 /dev/null /etc/gaubee-search.env
sudo tee /etc/gaubee-search.env >/dev/null <<'EOF'
MAGPIE_API_KEY=replace-with-caller-key
MAGPIE_URL=http://127.0.0.1:3425
EOF
sudo chown root:root /etc/gaubee-search.env
```

> **生产必须使用宿主机 magpie**：search-server 容器用 `network_mode: host`，
> 监听 `127.0.0.1:17082`，`MAGPIE_URL=http://127.0.0.1:3425`。bridge 网络访问
> 不到宿主 loopback，且公网 magpie 的 query embedding 延迟会超过客户端超时。
> 若 17082 冲突，同步修改 `SEARCH_BIND` 与 openresty 的 `proxy_pass`。

```yaml
services:
  search-server:
    image: ghcr.nju.edu.cn/gaubee/gaubee-search:latest
    # 或本地构建：
    # build:
    #   context: ..
    #   dockerfile: search-server/Dockerfile
    container_name: gaubee-search-server
    restart: unless-stopped
    labels:
      - "com.centurylinklabs.watchtower.enable=true"
    # 与宿主机 magpie 共用 loopback；不能同时写 ports
    network_mode: host
    volumes:
      # 索引单文件落在宿主卷：容器重建/升级不丢，首次启动自动构建
      - /opt/gaubee/search:/data
    env_file:
      - /etc/gaubee-search.env
    environment:
      RUST_LOG: info
      EMBED_BATCH_SIZE: "48"
      EMBED_CONCURRENCY: "4"
      MAGPIE_BUILD_TIMEOUT_MS: "180000"
      MAGPIE_TIMEOUT_MS: "1000"
      # host 网络：直接监听宿主 loopback，供同机 openresty 反代
      SEARCH_BIND: 127.0.0.1:17082
    mem_limit: 512m
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://127.0.0.1:17082/health"]
      interval: 30s
      timeout: 3s
      retries: 3
      # 首次启动要调 magpie 建索引；按实测构建时间放宽（见第 7 节）
      start_period: 5m
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

内存说明：索引向量约 1985 chunk × 1024 维 ≈ 8 MB，加上 jieba 词典（约 44 MB）、
元数据与 SQLite 页缓存，实测 RSS 见第 7 节；512 MB limit 留有充足余量。

`network_mode: host` 下容器不再做端口映射，`127.0.0.1:17082` 就是宿主端口，
openresty 的 `proxy_pass http://127.0.0.1:17082` 与容器 healthcheck
`curl http://127.0.0.1:17082/health` 都直接命中该监听。**不要同时保留 `ports`**。

## 4. openresty 反代

容器使用 host 网络并监听宿主 `127.0.0.1:17082`；openresty 在同一宿主网络命名空间，
以下 location 不需要改动（`proxy_pass` 指向宿主 loopback）：

```nginx
location = /api/search {
    limit_except POST { deny all; }

    proxy_pass http://127.0.0.1:17082/api/search;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Connection "";
    proxy_connect_timeout 2s;
    proxy_read_timeout 10s;
    proxy_send_timeout 10s;
    add_header Cache-Control "no-store" always;
}

location = /api/search/health {
    allow 127.0.0.1;
    allow ::1;
    deny all;
    proxy_pass http://127.0.0.1:17082/health;
}
```

## 5. 索引生命周期

### 5.1 容器启动（entrypoint）

```
check /data/index.sqlite 的 contentHash 与 /app/content 当前指纹
├── 一致 → serve
└── 缺失/不一致 → build（写临时文件，成功后原子 rename）
    ├── 成功 → serve
    ├── 失败且有旧索引 → 用旧索引 serve，stderr 告警
    └── 失败且无索引 → exit 1（容器重启，watchtower/人工介入）
```

- 内容指纹覆盖每篇的 `title + tags + date + 正文 sha256`，按 parentId 排序后汇总。
- 内容更新需要重建镜像（`src/content` 在镜像内）；新容器首次启动自动重建索引。
- 构建失败不会破坏旧索引；旧索引缺少新内容，但搜索仍可用。
- 查询 embedding 不可用时，服务仍可 FTS-only 运行；构建则必须能调通 magpie。

### 5.2 首次建索引耗时

见第 7 节实测。构建是 I/O + 网关推理，耗时主要取决于网关吞吐和 `src/content`
规模；`start_period` 必须大于「首次构建时间 + 启动」，否则容器会被标记 unhealthy。

### 5.3 手动重建 / 回滚

```bash
# 重建（保留上一代副本）
sudo cp -a /opt/gaubee/search/index.sqlite /opt/gaubee/search/index.sqlite.prev
docker compose restart search-server
# 或强制：删除索引后重启
sudo rm -f /opt/gaubee/search/index.sqlite
docker compose restart search-server

# 验证
curl -fsS http://127.0.0.1:17082/health | jq

# 回滚（索引文件级别）
sudo mv /opt/gaubee/search/index.sqlite.prev /opt/gaubee/search/index.sqlite
docker compose restart search-server
```

回滚镜像时注意：旧版镜像（zvec）使用 `/app/index` 目录与不同 volume 布局，
索引文件**不能**跨引擎复用；切回旧版需恢复旧 compose/volume。

### 5.4 CI 预构建（可选）

若不想让首次启动耗时落在线上，可在 CI（linux/amd64）用同一二进制构建索引：

```bash
MAGPIE_API_KEY=... search-server build \
  --content src/content \
  --index build/index.sqlite \
  --embed-batch-size 64 --embed-concurrency 4
# 把 build/index.sqlite 上传到服务器 /opt/gaubee/search/index.sqlite
# compose 设置 BUILD_ON_START=0，或保留 1（hash 一致时只做 check）
```

索引是单文件，原子替换即可；无需重启 openresty。

## 6. 旧版清理

- 旧镜像内的 zvec SDK / E5 模型 / ONNX Runtime 不再使用；部署新镜像后旧镜像可删。
- 旧 `search-server/scripts/fetch-model.sh`、`fetch-zvec-sdk.sh`、`build.rs`、
  `src/zvec_ffi.rs` 已移除。
- `/opt/gaubee/search-index`（目录形态）可删除，改为 `/opt/gaubee/search/index.sqlite`。

## 7. 基准（本机 macOS arm64，2026-11-26）

环境：macOS arm64（M 系列），`search-server` release（rustc 1.98），
`mistral-embed` 1024 维。本机没有真实 magpie 进程，用 `127.0.0.1:3425` 的
loopback shim 转发到公网 magpie，验证 host 网络/本地 URL 路径；shim 的公网
延迟高于生产同机 magpie，生产延迟以服务器实测为准（见风险段）。

- 内容：1505 篇（articles 63 / events 1442），**1985 chunks**
  （1600 字符窗口 / 200 overlap / 单篇最多 8 chunk）。
- 首次构建（entrypoint 走 `http://127.0.0.1:3425`）：**78.5 s**，batch 48 × 4
  并发；mistral 对 64 条 1600 字符 chunk 会报 `Too many tokens overall`，服务自动二分拆批
  （本次共 73 个成功请求，含 1 次 400 拆批）。manifest 自动写入
  `"model":"mistral-embed","embedDim":1024`。
- 索引：**16.7 MiB（17,559,552 字节）**，单文件 `/data/index.sqlite`。
- 进程 RSS：启动并完成 jieba 预热后 **67.3 MiB**；跑完 20 条查询 + 缓存命中后
  **72.6 MiB**（`ps -o rss`，macOS）。目标 <150 MB、理想 <100 MB 均满足。
  （未预热时启动约 30 MiB；jieba 词典约 44 MB 常驻，serve 启动时主动预热。）
- 纯 FTS 查询（60 次）：服务端 `tookMs` 中位 **0 ms**、p95 **1 ms**、最大 6 ms；
  HTTP 端到端中位 **1.13 ms**、p95 **1.76 ms**、最大 7.65 ms。
- hybrid 端到端（20 条中英混合，`MAGPIE_TIMEOUT_MS=30000`，公网 shim）：
  冷查询中位 **2452 ms**、p95 **4583 ms**、最小 1782 ms、最大 4583 ms；
  全部 `degraded=false`。延迟几乎全部来自公网 embedding 调用，本地 FTS +
  向量扫描为毫秒级。**生产同机 mistral 实测 p50 387 ms / max 580 ms**（用户实测），
  配合 1200 ms 客户端超时留有约 620 ms 余量。
- 进程内 LRU（256 条，key = 模型 + 查询文本）：第一轮 20 条全部 miss；
  第二轮同样的 20 条全部 hit，命中后 HTTP 中位 **5 ms**、p95 10 ms。
  基准结束 `/health` 为 `embedCacheEntries=25, embedCacheHits=22, embedCacheMisses=25`
  （含过滤/特殊字符请求；第二轮命中率 100%）。
- 与线上 zvec（`https://gaubee.com/api/search`）同查询 top-5 对比：
  平均重合 **2.15/5**（中位 2；分布 0 条×2、1 条×5、2 条×4、3 条×6、4 条×3）。
  排名差异来自 chunk 粒度、embedding 模型与 RRF 融合，属预期。
- 降级验证：把 `MAGPIE_TIMEOUT_MS` 设为 2000 并用公网 shim 时，首轮 20 条查询
  全部在约 2.0 s 返回 `degraded=true`（FTS-only）；本地 mistral p50 387 ms
  不应触发。`mode=fts` 不调用 embedding。
- 过滤/边界：apps、excludeApps、tags、dateFrom/dateTo 均生效；空查询返回空；
  `"`/`%_%`/`C++`/`!!!` 不报错；`github 日报` 的 20 条结果 parent 唯一；
  257 字查询返回 400。
- host 网络验证：服务绑定 `127.0.0.1:17082`（`lsof` 仅 loopback）；同机反向代理
  （模拟 openresty）访问 `/health` 与 `/api/search` 均 200。entrypoint 在
  `MAGPIE_URL=http://127.0.0.1:3425` 下成功建索引并 serve；内容变化 + 无效 key
  时构建失败，旧索引 sha256 不变并继续对外 serve。
- 镜像体积：本机 Docker daemon 不可用，未实测；按层估算
  `debian:trixie-slim ~80 MB + 二进制 10 MB + src/content 13 MB + curl ~8 MB`
  ≈ **110–120 MB**，满足 <150 MB 目标。

> **查询延迟风险**：生产必须使用同机 magpie（`network_mode: host` +
> `http://127.0.0.1:3425`）。服务器实测 mistral p50 387 ms / max 580 ms，
> 客户端 1200 ms（冷启动 2500 ms）可覆盖；公网 magpie 单次 1.5–27 s，不可用于
> hybrid。服务端仍保留 2 s 超时降级 FTS 作为兜底；若 `/health` 的 degraded
> 频繁出现，先查网关本地延迟，再考虑调整 `MAGPIE_TIMEOUT_MS`。LRU 命中时
> 查询约 5 ms，能显著降低重复 query 的网关压力。

## 8. 安全与许可证

- `MAGPIE_API_KEY` 只通过 `env_file: /etc/gaubee-search.env`（chmod 600）注入；
  不写入镜像、仓库、日志。日志只打印模型名、状态码与耗时不打印 key。
- 只索引 `src/content` 公开内容；索引文件只含公开标题/正文/标签/链接。
- 依赖：
  | 组件 | 许可证 |
  | --- | --- |
  | SQLite（bundled） | Public Domain |
  | rusqlite | MIT |
  | jieba-rs | MIT |
  | axum / tower-http | MIT |
  | reqwest / rustls | MIT / Apache-2.0 |
  | mistral-embed | 通过 magpie 网关调用，按网关计费/配额（1024 维） |
- 换 embedding 模型会改变维度；索引元数据记录 `embedDim`，维度不一致时查询会
  自动降级 FTS-only（并告警），不会返回错误结果。

## 9. 故障排查

| 现象 | 检查 |
| --- | --- |
| 502 / 连接拒绝 | 容器是否 running；`curl 127.0.0.1:17082/health`；端口是否被占用 |
| 启动即退出 | `docker logs`：无旧索引且构建失败（magpie 不可达/key 缺失/内容为空） |
| health 长时间 unhealthy | 首次构建仍在进行；看 `docker logs -f` 的 embedding 进度，放宽 `start_period` |
| 搜索一直 `degraded=true` | 查询 embedding 超时/失败：测 `MAGPIE_URL` 延迟；看日志中的状态码；临时调大 `MAGPIE_TIMEOUT_MS` |
| 客户端一直走 MiniSearch | 浏览器 Network 看 `/api/search` 状态；openresty location 是否精确匹配；CORS 预检是否被 WAF 拦 |
| 结果不含新文章 | 内容在镜像内：重建镜像并重启；`/health` 的 `indexBuiltAt` 是否变化 |
| 索引损坏/无法打开 | 删除 `/opt/gaubee/search/index.sqlite` 重启，自动重建 |
| openresty 502 / 端口不通 | 容器是否 `network_mode: host`；`lsof -iTCP:17082 -sTCP:LISTEN` 是否只监听 127.0.0.1 |
| 构建报 EACCES / 无法写索引 | `/opt/gaubee/search` 属主不是 10001：按第 3 节 `chown 10001:10001` |
