# search-server 部署手册（SQLite FTS5 + 本地 llama.cpp embedding）

> 状态：2026-11-26 切到**全本地** embedding。旧 zvec/ONNX 进程内模型、magpie 远程
> embedding 都已停用（magpie 的 mistral 订阅预算耗尽，返回 402，已不可依赖）。
>
> 引擎：SQLite（FTS5 + 暴力余弦扫描，rusqlite bundled）+ 本地
> `llama-server`（llama.cpp）+ EmbeddingGemma 2 文本 q4 GGUF（768 维）。

## 1. 拓扑

```
浏览器 ──/api/search──> openresty (TLS, 17080)
                             │  proxy_pass 127.0.0.1:17082
                             ▼
              gaubee-search-server（host 网络，61 MiB RSS）
              POST /api/search, GET /health
              /data/index.sqlite（SQLite 单文件索引，只读挂载）
                             │
                             │ POST http://127.0.0.1:18081/v1/embeddings
                             ▼
              gaubee-embed（host 网络，263 MiB RSS）
              llama-server + embeddinggemma-2-UD-Q4_K_XL.gguf
```

- 两个容器都是 `network_mode: host`，只监听 loopback；对外由 openresty 终结 TLS。
- 索引是单文件 `/data/index.sqlite`，宿主 `/opt/gaubee/search-models/`，**只读挂载**。
- 模型 `/opt/gaubee/search-models/embeddinggemma-2-UD-Q4_K_XL.gguf`（168 MB），只读挂载。
- 客户端仍是 `POST /api/search`；服务端查询 embedding 超时 3s，超时降级 FTS
  （响应 `degraded: true`），客户端再回退浏览器端 MiniSearch。
- serve 侧 query embedding 有 256 条进程内 LRU（key = 向量空间身份 + 查询文本）。

> **端口**：`17081` 被 cdn-media-pointer 占用，搜索服务固定 `17082`；
> embedding 服务用 `18081`（仅 loopback）。

## 1.1 API 契约

```http
POST /api/search
Content-Type: application/json

{ "q": "语义查询", "mode": "hybrid|vector|fts", "limit": 10, "offset": 0,
  "apps": ["article"], "excludeApps": [], "tags": [], "dateFrom": 0, "dateTo": 0 }
```

```json
{ "results": [{ "id", "appId", "appName", "title", "excerpt", "href", "date", "score" }],
  "total": 42, "tookMs": 12, "engine": "sqlite-fts5", "degraded": false }
```

`GET /health` 关键字段：

| 字段 | 含义 |
| --- | --- |
| `engine` | `sqlite-fts5` |
| `vectorEnabled` | 向量检索是否启用（模型身份与索引不一致时为 false，仅 FTS） |
| `indexModel` / `activeModel` | 形如 `embeddinggemma-2:gemma2`，含任务前缀模板 |
| `embedDim` | 768 |
| `docs` / `documents` / `chunks` | chunk 数 / 文档数 / manifest 记录数 |
| `embedCache*` | 查询向量缓存命中统计 |

## 1.2 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `EMBED_URL` | `http://127.0.0.1:18081` | embedding 服务地址（llama-server 或任何 OpenAI 兼容网关） |
| `EMBED_API_KEY` | 空 | 远程网关才需要；loopback 地址自动放行空 key |
| `EMBED_MODEL` | `embeddinggemma-2` | 请求体里的 model 名 |
| `EMBED_PROMPTS` | `gemma2` | 任务前缀模板：`gemma2` / `bge-zh` / `none`。**必须与建索引时一致** |
| `EMBED_TIMEOUT_MS` | `3000` | serve 查询 embedding 超时，超时降级 FTS |
| `EMBED_QUERY_RETRIES` | `0` | 查询重试次数；默认超时即降级 |
| `EMBED_BATCH_SIZE` | `16` | 构建期每请求条数（本地单 slot，太大会排队） |
| `EMBED_CONCURRENCY` | `1` | 构建期并发（llama-server 单 slot 时只能 1） |
| `EMBED_BUILD_TIMEOUT_MS` | `900000` | 构建期单请求超时（1600 字符 chunk 单批可达数分钟） |
| `EMBED_INCREMENTAL` | `true` | 复用旧索引中内容未变的向量 |
| `EMBED_MAX_NEW_CHUNKS` | `0` | 增量重建允许新算的 chunk 上限；自动任务设 300，超过即中止（防误触发全量） |
| `INDEX_FILE` | `/data/index.sqlite` | 索引文件 |
| `CONTENT_DIR` | `/app/content` | 镜像内公开内容目录 |
| `BUILD_ON_START` | `0` | 生产默认 0：只 check 不重建；`1` 才在启动时重建 |
| `SEARCH_BIND` | `127.0.0.1:17082` | host 网络下监听宿主 loopback |
| `RUST_LOG` | `info` | 日志级别 |

## 2. 构建镜像

构建上下文必须是仓库根目录（内容在 `src/content`）：

```bash
docker build -f search-server/Dockerfile -t gaubee-search:sqlite .
```

镜像约 **144 MB**（debian:trixie-slim + 二进制 + 内容），不含模型与 llama.cpp。

## 3. compose service

```yaml
  gaubee-embed:
    image: gaubee-llama:local          # 见 3.1
    container_name: gaubee-embed
    restart: unless-stopped
    network_mode: host
    mem_limit: 600m
    volumes:
      - /opt/gaubee/search-models:/models:ro
    command:
      - -m
      - /models/embeddinggemma-2-UD-Q4_K_XL.gguf
      - --embeddings
      - --pooling
      - mean
      - --embd-normalize
      - "2"
      - -c
      - "4096"
      - -b
      - "4096"
      - -ub
      - "4096"
      - -np
      - "1"
      - -t
      - "2"
      - -ngl
      - "0"
      - --host
      - 127.0.0.1
      - --port
      - "18081"

  search-server:
    image: gaubee-search:sqlite-local
    container_name: gaubee-search-server
    restart: unless-stopped
    network_mode: host
    volumes:
      - /opt/gaubee/search-models:/data:ro
    environment:
      SEARCH_BIND: 127.0.0.1:17082
      INDEX_FILE: /data/index.sqlite
      EMBED_URL: http://127.0.0.1:18081
      EMBED_MODEL: embeddinggemma-2
      EMBED_PROMPTS: gemma2
      EMBED_TIMEOUT_MS: "3000"
      BUILD_ON_START: "0"
    mem_limit: 300m
    depends_on:
      - gaubee-embed
```

### 3.1 llama-server 镜像

服务器是 CentOS 7，宿主 glibc/OpenSSL 太老，llama.cpp 官方预编译二进制无法直接运行；
放进 trixie 容器即可。构建方式（一次性）：

```bash
# 下载官方发布包（b12728 起支持 gemma-embedding2 架构）
curl -fL -o llama.tar.gz \
  https://github.com/ggml-org/llama.cpp/releases/download/b12728/llama-b12728-bin-ubuntu-x64.tar.gz
tar -xzf llama.tar.gz                       # → llama-b12728/
mkdir -p /tmp/llama-img && cd /tmp/llama-img
cat > Dockerfile <<'EOF'
FROM debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      libgomp1 libssl3 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY llama-b12728/ /opt/llama/
ENV LD_LIBRARY_PATH=/opt/llama
ENTRYPOINT ["/opt/llama/llama-server"]
EOF
cp -r ../llama-b12728 .
docker build -t gaubee-llama:local .
```

> **上下文必须够大**：`-c 1024` 会让 1600 字符的 chunk（约 724–793 token）在批内
> 叠加时直接 400。用 `-c 4096 -np 1`；`-np 2` 会把上下文对半分，等同于 2048。

## 4. openresty 反代

```nginx
location = /api/search {
    proxy_pass http://127.0.0.1:17082/api/search;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_read_timeout 10s;
}
location = /health {
    proxy_pass http://127.0.0.1:17082/health;
}
```

## 5. 索引生命周期

### 5.1 容器启动（entrypoint）

```
check /data/index.sqlite：
  1) 结构完整性：格式版本 / docs 与 vectors 表 / 行数一致 / 向量长度 / PRAGMA quick_check
  2) contentHash 与 /app/content 当前指纹
  3) manifest.model 与 `EMBED_MODEL:EMBED_PROMPTS`（向量空间身份）
├── 全部一致 → serve（vectorEnabled=true）
└── 任一不匹配：
    ├── BUILD_ON_START=1 → build（写临时文件，成功后原子 rename）
    │   ├── 成功 → serve
    │   ├── 失败且有旧索引 → 用旧索引 serve
    │   └── 失败且无索引 → exit 1
    ├── BUILD_ON_START=0 且结构完整（内容/模型过期）→ **服务旧索引**并告警，
    │   等 index-sync 增量重建（避免 auto-update 重建容器时崩溃循环）
    └── BUILD_ON_START=0 且索引缺失/损坏 → exit 1，并打印离线重建命令
```

- **生产用 `BUILD_ON_START=0`**：服务器只有 2 核，全量重建要小时级，不能放在启动路径。
- `check --allow-stale` 只放宽「内容/模型过期」，结构损坏仍然失败；这是 auto-update
  每 5 分钟可能重建容器时的安全垫。
- 完整性校验是新增的（2026-11-26）：损坏或版本不符的索引不再「check 通过、serve 崩」，
  避免容器进入崩溃循环。
- 内容指纹覆盖 `title + tags + date + 正文 sha256`，按 parentId 排序后汇总。
- 模型与**前缀模板**都参与身份判定：`embeddinggemma-2:gemma2` ≠ `embeddinggemma-2:none`。

### 5.2 增量重建

`build` 默认读旧索引，按 `(parentId, chunkIndex)` 比对 `content_hash`：
hash 相同、chunk 序号相同的直接复用旧向量，只对新增/改动文档调 embedding。

实测（2026-11-26，本地 M 系列）：新增 2 篇日报 → `reused=1983 / todo=8`，
耗时 150 秒；同规模全量重建约 58 分钟。

```bash
# 日常增量（在能访问 embedding 服务的机器上）
search-server build --content src/content --index /tmp/index.sqlite \
  --embed-url http://127.0.0.1:18081 --embed-model embeddinggemma-2 --embed-prompts gemma2

# 强制全量
search-server build ... --incremental false
```

> 增量可复用的前提是**窗口参数与前缀模板都没变**。改 `chunk.rs` 的
> `WINDOW_CHARS/OVERLAP_CHARS` 或 `EMBED_PROMPTS`，所有 hash 都会变，等于全量。

### 5.3 手动重建 / 发布流程（当前生产做法）

索引在**构建机**上离线生成，再上传到服务器（不要在 2 核服务器上全量重建）：

```bash
# 1. 本地（或 CI）增量重建到最新内容
#    增量复用读的是 --index 指向的旧索引：先拷一份线上索引，或就地在副本上构建。
cd search-server
cp /path/to/current/index.sqlite /tmp/index.sqlite
cargo run --release -- build \
  --content ../src/content --index /tmp/index.sqlite \
  --embed-url http://127.0.0.1:18081 --embed-model embeddinggemma-2 --embed-prompts gemma2

# 2. 校验（contentMatch / modelMatch / integrity 三绿）
cargo run --release -- check \
  --content ../src/content --index /tmp/index.sqlite \
  --embed-model embeddinggemma-2 --embed-prompts gemma2

# 3. 上传并原子替换（保留上一代）
scp /tmp/index.sqlite gaubee-cloud:/opt/gaubee/search-models/index.sqlite.new
ssh gaubee-cloud 'cd /opt/gaubee/search-models && \
  cp index.sqlite index.sqlite.prev && mv index.sqlite.new index.sqlite'

# 4. 重启搜索容器（索引只读挂载，进程内已加载旧副本）
ssh gaubee-cloud 'cd /etc/edge/gaubeeos && docker compose restart search-server'

# 5. 验证
curl -fsS http://127.0.0.1:17082/health | jq '{engine,vectorEnabled,indexModel,docs}'
```

回滚：`mv index.sqlite.prev index.sqlite` 后重启。索引是单文件，原子替换即可。

### 5.4 索引与发布的先后

`src/content` 随镜像发布；**新 event 一发布，线上索引就相对内容变旧**。
索引只用于搜索召回，变旧不影响站点渲染，但新文章搜不到。

### 5.5 自动追索引（index-sync）

发布链路已经自动化，不再需要人跑 5.3：

```
日报发布 → CI 重建 gaubee-search 镜像（含新 src/content）
         → 服务器 auto-update（每 5 分钟）拉镜像并重建容器（此时服务旧索引）
         → index-sync（每 10 分钟）发现镜像内容比索引新 → 增量重建 → 重启 search-server
```

安装（一次性）：

```bash
scp search-server/scripts/index-sync.sh gaubee-cloud:/etc/edge/gaubeeos/index-sync.sh
ssh gaubee-cloud 'chmod +x /etc/edge/gaubeeos/index-sync.sh'
ssh gaubee-cloud '(crontab -l 2>/dev/null; echo "*/10 * * * * /etc/edge/gaubeeos/index-sync.sh >> /var/log/gaubee-search-index.log 2>&1") | crontab -'
```

机制与保护：

- 用 `index.source` 侧文件记录「索引来自哪个镜像 ID」；镜像没变就直接跳过（零成本）。
- 先跑 `check`：内容一致只更新侧文件；结构损坏则拒绝自愈并告警。
- 只做增量；`--max-new-chunks 300` 兜底——窗口参数或模型变化会变成全量，直接中止，
  要求回构建机处理。正常日报增量是 8–30 个 chunk，2–5 分钟。
- 重建失败保留旧索引；线上始终有可服务的索引。
- 日志：`/var/log/gaubee-search-index.log`，cron 每 10 分钟一次，`flock` 防重入。

手动触发一次：

```bash
ssh gaubee-cloud '/etc/edge/gaubeeos/index-sync.sh'
```

## 6. 旧版清理

- 旧 zvec 容器 / `ghcr.io/gaubee/gaubee-search:latest`（745 MB）已停用，可删。
- 旧 `scripts/fetch-model.sh`、`fetch-zvec-sdk.sh`、`build.rs`、`src/zvec_ffi.rs` 已移除。
- `/opt/gaubee/search-index`（zvec 目录形态）可删除。
- 旧 magpie 相关环境变量（`MAGPIE_*`）不再使用，compose 里已移除。

## 7. 基准与实测（2026-11-26）

### 7.1 内存

| 组件 | RSS |
| --- | ---: |
| gaubee-search-server（SQLite + 1991 chunks） | **62–66 MiB** |
| gaubee-embed（EG2 q4 + llama.cpp，2 线程） | **263–301 MiB**（随负载波动） |
| 合计 | **约 325–370 MiB** |
| 旧 zvec 单容器（对比） | 809 MiB |

### 7.2 延迟（服务器 2 核 Xeon Cascadelake，宿主直连 17082）

| 场景 | 耗时 |
| --- | ---: |
| 查询 embedding（预热后，EG2 768d） | ~110 ms |
| 纯向量检索（1985 chunks 暴力扫描） | 1–2 ms |
| FTS 检索 | 5–7 ms |
| hybrid 端到端（服务端） | **10–86 ms** |
| 首次查询（含模型预热） | ~500 ms |

### 7.3 构建吞吐（决定重建时间）

| 环境 | 1600 字符 chunk |
| --- | ---: |
| 本地 M 系列（8 线程） | ~1.5 s/篇 |
| 服务器 2 核 | ~7.9 s/篇 |

1985 chunks 全量：本地约 58 分钟，服务器 3 小时以上 → 故生产离线构建。

### 7.4 检索质量抽样（生产 hybrid）

| 查询 | Top1 |
| --- | --- |
| 异步运行时是怎么实现的 | 简单解构 Iced 运行时模型与设计哲学（0.977） |
| 怎么减少服务的内存占用 | X 日报 2026-10-21（0.911） |
| JavaScript（限 article） | 如何开始一个模块化可扩展的 Web App（0.984） |

## 8. 换 embedding 模型

向量空间身份 = `EMBED_MODEL:EMBED_PROMPTS`，写进 manifest；`check`/`serve` 都会比对。

换模型步骤：

1. 确认新模型在 llama.cpp 里受支持（架构名，例如 `gemma-embedding2` 需要 b12728+）。
2. 选定 GPT 前缀模板；若现有 `PromptProfile` 不匹配，在 `embed.rs` 加一个变体。
3. **全量重建**索引（旧向量不可复用：维度或分布不同）：
   `search-server build ... --incremental false`。
4. 上传索引，`docker compose restart search-server`。
5. `curl /health` 确认 `indexModel == activeModel` 且 `vectorDim` 符合预期。

换模型时记得同步 `deploy` 里的 `-c`（新模型的滑动窗口决定 chunk 窗口），
以及 `chunk.rs` 的 `WINDOW_CHARS`（改了必然触发全量重建）。

### 8.1 候选模型（实测数据，2026-11-26）

| 模型 | 权重 | 进程 RSS | 查询 | 1600 字符文档 | 中文质量 |
| --- | ---: | ---: | ---: | ---: | --- |
| **EmbeddingGemma 2 文本 q4_K_XL** | 168 MB | 344 MB（macOS）/ 263 MB（容器） | 69 ms | 1.5 s | 好，多语言 |
| bge-small-zh-v1.5 q8 | 26 MB | 108 MB | 14 ms | 231 ms | 中文强、英文弱，**512 token 上限** |
| magpie `mistral-embed`（远程） | 0 | 0 | 387 ms | — | 2026-11-25 预算耗尽（402） |

bge-small-zh 看起来更省，但 512 token 上下文装不下 1600 字符 chunk（实测 694 token
直接 400），要选它必须把 `WINDOW_CHARS` 降到 400 左右，chunk 数翻倍。

## 9. 安全与许可证

- 模型：EmbeddingGemma 2，Apache 2.0；GGUF 由 unsloth 转换（同许可）。
- llama.cpp：MIT。
- 两个容器都只监听 loopback；不对外暴露 18081/17082。
- `EMBED_API_KEY` 只在需要远程网关时设置，经 env_file 注入，不进镜像/日志。

## 10. 故障排查

| 现象 | 排查 |
| --- | --- |
| `/health` 里 `vectorEnabled=false` | `indexModel` 与 `activeModel` 是否相同；不同则索引与当前 `EMBED_*` 不匹配，重建或改回 |
| 响应 `degraded=true` | embedding 服务不可达或超时；`docker logs gaubee-embed`、`curl 127.0.0.1:18081/health` |
| 容器反复重启 | 索引结构损坏或缺失（stale 会照常服务）；看日志里的完整性原因，按 5.3 重建 |
| embedding 返回 400「is larger than the max context size」 | llama-server `-c` 太小或 `-np` 把上下文对半分；改 `-c 4096 -np 1` |
| 查询很慢（>1s） | 首次查询在预热模型；持续慢则看 `docker stats` 的 CPU 是否被其它容器抢占 |
| openresty 502 | 容器是否 `network_mode: host`；`ss -tlnp \| grep 17082` 是否只监听 127.0.0.1 |
| 新文章搜不到 | 等 index-sync（每 10 分钟）；或手动跑一次并看 `/var/log/gaubee-search-index.log` |
| 内存吃紧 | search-server 限 300m、embed 限 600m；如实测 RSS 明显上涨，先看是否 `-np` 被调大 |
