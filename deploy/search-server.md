# search-server 部署手册（SQLite FTS5 + magpie embedding）

> 状态：2026-11-26 重构为方案 A（远程 embedding + 轻量 SQLite 索引）。旧 zvec/ONNX
> 进程内模型已移除；运行镜像不再包含 zvec SDK、ONNX Runtime 与 E5 模型。
> 引擎：SQLite（FTS5 + 暴力余弦扫描，rusqlite bundled）+ magpie 网关
> `text-embedding-3-small`（1536 维，可切换 `mistral-embed` 1024 维）。

## 1. 拓扑

```
浏览器 ──/api/search──> openresty (TLS, 17080)
                             │  proxy_pass 127.0.0.1:17082
                             ▼
                      search-server 容器（约 110 MB 镜像）
                      POST /api/search, GET /health
                      /data/index.sqlite（SQLite 单文件索引）
                             │
                             └── POST {MAGPIE_URL}/v1/embeddings
```

- 静态站点仍由现有 Rust axum static-server 容器提供；search-server 是**独立容器**。
- 索引是单文件 `/data/index.sqlite`，挂载宿主卷 `/opt/gaubee/search`，容器重建不丢。
- 客户端 `src/lib/search/server-service.ts` 无需修改：仍是 `POST /api/search`；
  800ms（冷启动 2s）超时后回退浏览器端 MiniSearch。
- 查询 embedding 失败/超时（默认 2s）时服务自动降级为 FTS-only，响应
  `degraded: true`，客户端照常展示 FTS 结果。

> **端口说明**：`127.0.0.1:17081` 已被 cdn-media-pointer 的 `python -m http.server`
> 占用。本服务默认 **17082**；若冲突，用 `SEARCH_SERVER_PORT` 覆盖并同步 openresty。

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
  `{ok, engine, embedModel, embedConfigured, embedDim, docs, documents, chunks, indexBuiltAt, index, uptimeMs}`。
  `docs` 是 chunk 数（兼容旧字段），`documents` 是去重后的篇数。

## 1.2 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `MAGPIE_URL` | `https://magpie.aiweb.xin` | 网关基础地址；可带 `/v1` 或完整 `/v1/embeddings` |
| `MAGPIE_API_KEY` | 无 | caller key；**只放 env_file，不进仓库/镜像/日志** |
| `MAGPIE_EMBED_MODEL` | `text-embedding-3-small` | 换模型必须重建索引（维度随模型变化） |
| `MAGPIE_TIMEOUT_MS` | `2000` | serve 查询 embedding 超时（毫秒），超时降级 |
| `MAGPIE_QUERY_RETRIES` | `0` | 查询重试次数；默认超时即降级，避免放大客户端超时 |
| `EMBED_BATCH_SIZE` | `64` | 构建期每请求条数（实测 magpie 接受 256） |
| `EMBED_CONCURRENCY` | `4` | 构建期并发请求数 |
| `MAGPIE_BUILD_TIMEOUT_MS` | `120000` | 构建期单请求超时 |
| `MAGPIE_MAX_RETRIES` | `5` | 429/5xx/超时重试次数 |
| `INDEX_FILE` | `/data/index.sqlite` | 索引文件 |
| `CONTENT_DIR` | `/app/content` | 镜像内公开内容目录 |
| `BUILD_ON_START` | `1` | 启动时检查/重建索引；`0` 表示只 serve |
| `SEARCH_BIND` | `0.0.0.0:17082` | 容器内监听地址 |
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
MAGPIE_URL=https://magpie.aiweb.xin
EOF
sudo chown root:root /etc/gaubee-search.env
```

> `MAGPIE_URL` 默认用公网 `https://magpie.aiweb.xin`。若 magpie 与
> search-server 在同一台服务器，优先改成 `http://127.0.0.1:3425` 并给容器加
> `network_mode: host`（或让容器使用宿主网络/同一内网地址）；容器默认的
> bridge 网络访问不到宿主 loopback。查询 embedding 延迟直接决定 hybrid 是否
> 可用，部署前先测网关本机延迟。

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
    ports:
      # 只发布到宿主 loopback；默认 17082
      - "127.0.0.1:${SEARCH_SERVER_PORT:-17082}:17082"
    volumes:
      # 索引单文件落在宿主卷：容器重建/升级不丢，首次启动自动构建
      - /opt/gaubee/search:/data
    env_file:
      - /etc/gaubee-search.env
    environment:
      RUST_LOG: info
      EMBED_BATCH_SIZE: "64"
      EMBED_CONCURRENCY: "4"
      MAGPIE_BUILD_TIMEOUT_MS: "180000"
      MAGPIE_TIMEOUT_MS: "2000"
      # 容器内必须监听 0.0.0.0，宿主端口已限制 loopback
      SEARCH_BIND: 0.0.0.0:17082
    mem_limit: 512m
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://127.0.0.1:17082/health"]
      interval: 30s
      timeout: 3s
      retries: 3
      # 首次启动要调 magpie 建索引；按实测构建时间放宽（见第 7 节）
      start_period: 45m
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

内存说明：索引约 5k chunk × 1536 维 ≈ 30 MB 常驻向量 + 元数据 + SQLite 页缓存，
实测 RSS 见第 7 节；512 MB limit 留有充足余量。

若网关在宿主上，容器访问 `127.0.0.1:3425` 需要 `network_mode: host`（此时
`ports` 不再生效，直接监听宿主 17082）或改用公网 URL。**推荐先在本机/服务器
实测 `MAGPIE_URL` 的查询延迟，再决定 hybrid 超时。**

## 4. openresty 反代

与旧版一致，无需修改 location 语义：

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
`text-embedding-3-small` 1536 维，magpie 走公网 `https://magpie.aiweb.xin`。

- 内容：1505 篇（articles 63 / events 1442），**1985 chunks**
  （1600 字符窗口 / 200 overlap / 单篇最多 8 chunk）。
- 首次构建：**242.0 s（4m02s）**，batch 64 × 4 并发，重试 5；
  约 8.2 chunks/s（公网网关）。索引 **23.5 MiB（24,686,592 字节）**。
- 进程 RSS：启动并完成 jieba 预热后 **73.6 MiB**；60 次 FTS 查询后
  **75.3 MiB**（`ps -o rss`，macOS）。目标 <150 MB、理想 <100 MB 均满足。
  （未预热时启动 30 MiB；jieba 词典约 44 MB 常驻，serve 启动时主动预热。）
- 纯 FTS 查询（60 次）：服务端 `tookMs` 中位 **0 ms**、p95 **0 ms**、最大 2 ms；
  HTTP 端到端中位 **1.1 ms**、p95 **1.5 ms**、最大 9.5 ms。
- hybrid/vector 端到端（20 条中英混合查询，`MAGPIE_TIMEOUT_MS=30000`）：
  中位 **2134 ms**、p95 **8559 ms**、最小 1549 ms、最大 8559 ms；
  全部 `degraded=false`。延迟几乎全部来自公网 embedding 调用（1.5–27 s/次），
  本地向量扫描与 FTS 合计为毫秒级。
- 与线上 zvec（`https://gaubee.com/api/search`）同查询 top-5 对比：
  平均重合 **2.1/5**（中位 2；分布 1 条×5、2 条×9、3 条×5、4 条×1）。
  排名差异来自 chunk 粒度、embedding 模型与 RRF 融合，属预期。
- 降级验证：`MAGPIE_TIMEOUT_MS=2000` 时 hybrid/vector 均在约 2.0–2.2 s 返回
  `degraded=true`，结果是 FTS-only；`mode=fts` 不调用 embedding。
- 过滤/边界：apps、excludeApps、tags、dateFrom/dateTo 均生效；空查询返回空；
  `"`/`%_%`/`C++`/`!!!` 不报错；`github 日报` 的 20 条结果 parent 唯一；
  257 字查询返回 400。
- 镜像体积：本机 Docker daemon 不可用，未实测；按层估算
  `debian:trixie-slim ~80 MB + 二进制 10 MB + src/content 13 MB + curl ~8 MB`
  ≈ **110–120 MB**，满足 <150 MB 目标。

> **查询延迟风险（必须上线前确认）**：公网 magpie 的单次 query embedding 为
> 1.5–8.6 s，而站点客户端超时是 800 ms（冷启动 2 s）。若生产环境
> `MAGPIE_URL` 不是本机低延迟网关，浏览器会在拿到 hybrid 结果前回退
> MiniSearch。服务端 2 s 超时后也会降级 `degraded=true`。上线前请在服务器
> 容器内实测 `MAGPIE_URL` 的单次 embedding 延迟；必要时改用本机网关或
> 调整模型/部署位置（客户端契约不变，无法单独放宽 800 ms）。

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
  | text-embedding-3-small | 通过 magpie 网关调用，按网关计费/配额 |
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
| 构建报 EACCES / 无法写索引 | `/opt/gaubee/search` 属主不是 10001：按第 3 节 `chown 10001:10001` |
