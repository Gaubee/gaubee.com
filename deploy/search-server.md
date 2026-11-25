# search-server 部署手册（zvec 语义搜索）

> 状态：Phase 1 MVP 物料。**本文件不代表已部署**；生产变更需单独评审。
> 引擎：alibaba/zvec 0.8.1（进程内向量库，Apache-2.0）+ intfloat/multilingual-e5-small
> ONNX（MIT）+ ONNX Runtime（MIT，经 `ort` 构建期下载）。

## 1. 拓扑

```
浏览器 ──/api/search──> openresty (TLS, 17080)
                             │  proxy_pass 127.0.0.1:17082
                             ▼
                      search-server 容器
                      POST /api/search, GET /health
                      zvec collection + E5 模型（进程内）
```

- 静态站点仍由现有 Rust axum static-server 容器提供；search-server 是**独立容器**，
  不修改 `static-server/` 镜像。
- 索引与模型都在 search-server 容器内（或只读卷挂载），无外部数据库。
- 客户端失败/超时（800ms，冷启动首查 2s）自动回退浏览器端 MiniSearch。

> **端口说明**：`127.0.0.1:17081` 已被 cdn-media-pointer 的
> `python -m http.server` 占用（`deploy/cdn-base-rollout.md`）。本服务默认使用
> **17082**，compose 与 openresty 均已按 17082 写入；若 17082 再冲突，用
> `SEARCH_SERVER_PORT` 覆盖并同步 openresty。

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

响应：

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
  "engine": "zvec",
  "degraded": false
}
```

- 结果按 `parentId` 去重（同篇取最高分 chunk），`id` 即 parentId。
- `total` 是候选集内去重后的文档数，受 topk 截断，不是全库精确 count。
- `GET /health` 返回 `{ok, engine, zvecVersion, docs, documents, chunks, indexBuiltAt, index, uptimeMs}`。

## 2. 构建镜像

Dockerfile 使用多阶段构建，构建上下文必须是**仓库根目录**（内容在 `src/content`）：

```bash
cd /path/to/gaubee.com
docker build -f search-server/Dockerfile -t gaubee/search-server:zvec-0.8.1 .
```

`search-server/Dockerfile.dockerignore` 只放行 crate 源码与 `src/content/{articles,events}`，
不会把 node_modules/static 大目录送进构建上下文。

构建期会：
1. 下载并校验 zvec SDK v0.8.1（linux-amd64/arm64 按 `TARGETARCH`）。
2. `cargo build --release --locked`（ONNX Runtime 静态链接，运行期无需 ORT .so）。
3. 下载并校验 E5 模型（固定 revision + sha256）。
4. 运行 `search-server build` 生成索引（约 1500 篇 / 2900 chunks）。

镜像体积估算约 **700 MB**（base 80 + 二进制 35 + zvec 102 + 模型 448 + 索引 22）。
模型是主要占用；如把 `MODEL_DIR`/`INDEX_DIR` 改为只读卷，可降到 ~240 MB。

## 3. compose service

放到 1Panel 应用 compose（与站点 web 服务同一 compose 文件或独立文件均可）：

```yaml
services:
  search-server:
    image: docker.io/gaubee/search-server:zvec-0.8.1
    # 或本地构建：
    # build:
    #   context: ..
    #   dockerfile: search-server/Dockerfile
    container_name: gaubee-search-server
    restart: unless-stopped
    labels:
      - "com.centurylinklabs.watchtower.enable=true"
    ports:
      # 只发布到宿主 loopback；默认 17082（17081 被 cdn-media-pointer 占用）
      - "127.0.0.1:${SEARCH_SERVER_PORT:-17082}:17082"
    volumes:
      # 推荐：索引由 CI 产出后只读挂载，容器重建即换索引
      # - /opt/gaubee/search-index:/app/index:ro
      # 可选：模型放宿主卷，缩小镜像（需构建镜像时保留同路径占位）
      # - /opt/gaubee/models/multilingual-e5-small:/app/model:ro
    environment:
      RUST_LOG: info
      SEARCH_THREADS: "4"
      # 容器内必须监听 0.0.0.0，宿主端口已限制 loopback
      SEARCH_BIND: 0.0.0.0:17082
    mem_limit: 2g
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://127.0.0.1:17082/health"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 20s
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

内存上限说明：zvec 初始化时 `memory_limit=1 GiB`（`store.rs`），加上 ONNX session、
tokenizer 与查询峰值，实测 RSS 约 **0.45 GiB**（见第 6 节）；2 GiB limit 留有并发余量。
若并发搜索显著增长，先调 `SEARCH_THREADS`（ONNX 线程）与 zvec memory limit，再考虑升 limit。

## 4. openresty 反代

在站点 vhost（`gaubee.com.conf`）加入**精确匹配** location。`= /api/search` 的优先级
高于现有 `/api/`（auth/geo）前缀，不需要调整原 location 顺序：

```nginx
# 语义搜索：只允许 POST，同源请求，不缓存
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

# 健康检查只允许本机（运维 curl / 监控）
location = /api/search/health {
    allow 127.0.0.1;
    allow ::1;
    deny all;
    proxy_pass http://127.0.0.1:17082/health;
}
```

注意：

- 若 17082 冲突，用 `SEARCH_SERVER_PORT` 覆盖并同步上面两处 `proxy_pass`。
- openresty 的 WAF（1Panel `defaultUrlBlack`）对 `/api/search` 无 `.git` 等命中；
  如出现 403，先查 WAF req_log 而不是容器日志。
- 服务端已返回 `Access-Control-Allow-Origin: *`（只读公开数据），但生产走同源反代，
  不依赖 CORS。

## 5. 索引更新流程

### 5.1 推荐：CI 构建索引（不可变产物）

理由：索引构建需要 448 MiB 模型 + 约 5 分钟 CPU；放进运行容器会导致启动慢、
每次重启重建、且运行环境需要内容源码。CI 构建让容器启动即就绪，索引随发布版本可回滚。

流程（建议 GitHub Actions job，内容变更时触发）：

```bash
# CI runner（linux/amd64），缓存模型目录
./search-server/scripts/fetch-model.sh                # MODEL_DIR 默认 search-server/.cache
cargo build --release --locked --manifest-path search-server/Cargo.toml
./search-server/target/release/search-server build \
  --content src/content \
  --index build/search-index \
  --model-dir search-server/.cache/models/multilingual-e5-small \
  --threads 4

# 发布产物：build/search-index/{collection,manifest.json}
```

服务器侧原子替换（search-server 运行中不要原地改 collection）：

```bash
sudo rm -rf /opt/gaubee/search-index.next
sudo cp -a /tmp/artifact/search-index /opt/gaubee/search-index.next
sudo mv /opt/gaubee/search-index /opt/gaubee/search-index.prev
sudo mv /opt/gaubee/search-index.next /opt/gaubee/search-index
docker compose restart search-server
# 验证：curl -fsS http://127.0.0.1:17082/health | jq
```

回滚：把 `.prev` 换回来并重启。索引目录约 22 MB，保留上一代成本可忽略。

### 5.2 备选：容器启动时构建（不推荐）

需要把 `src/content` 与模型一起放进运行镜像，并让 entrypoint 先执行
`search-server build && search-server serve`。代价：

- 每次容器启动多 5+ 分钟（实测 2903 chunks ≈ 4.5 分钟，见第 6 节），健康检查需放宽；
- 索引写在容器可写层，重启即重算；要保留必须挂可写卷；
- 内容更新需要重建镜像（除非挂载内容目录），发布链更长。

只建议本地/预览环境使用。

### 5.3 每日增量（Phase 2，接口已就绪）

当前 CLI 只做全量重建。zvec 侧已提供 `upsert` 与 `delete_by_filter`（`store.rs`），
增量流程建议：

1. 每次构建额外输出 `index/parents.json`：`{parentId, contentHash, chunkIds[]}`。
   `contentHash` 已按「标题 + 标签 + 日期 + 正文」计算（`indexer::document_hash`）。
2. 每日任务加载新内容，与旧 `parents.json` 对比：
   - 新增/变更：`zvec_collection_delete_by_filter("parentId = '<id>'")` →
     embedding 新 chunks → `upsert`；
   - 删除：`delete_by_filter("parentId = '<id>'")`；
   - 未变化：跳过。
3. `optimize()` + `flush()`，写新 manifest。
4. 重启 search-server（当前无热加载；Phase 2 可加 SIGHUP 重建 store）。

鉴于索引仅 22 MB、全量构建约 5 分钟、内容日更量有限，**首期建议每日全量重建**
（CI 定时任务），比增量状态机更简单、更不易漂移；等索引/内容规模显著上升再启用增量。

## 6. 实测基准（本机 macOS arm64，Phase 1 验收）

本机 macOS arm64（M 系列，`SEARCH_THREADS=4`），2026-11-25 Phase 1 验收：

- 内容：1505 篇（articles 63 / events 1442），2903 chunks。
- 构建（8 线程）：**272.1 s**；索引 `index/collection` **21.6 MiB / 56 个文件**
  （dense HNSW + jieba FTS + 标量），`manifest.json` 4 KiB。
- 查询：冷启动首查 HTTP 端到端 34.5 ms；26 组查询 ×3 次（20 条中英混合 + app/date/tag
  过滤）中位 **5.23 ms**，p95 **6.46 ms**，最大 6.53 ms；服务端 `tookMs` 3–6 ms。
- 进程 RSS：启动并跑完基准后约 **445 MiB**（模型 448 MiB 为主要占用）。
- 浏览器端：真实预览页搜索返回 20 条；**停掉 search-server 后**同一查询由 MiniSearch
  接管，353 ms 出现结果，页面无报错。
- top-5 明细只记录在任务报告/基准日志，避免本文件随内容漂移。

## 7. 许可证与版本钉死

| 组件 | 版本 | 许可证 | 说明 |
| --- | --- | --- | --- |
| alibaba/zvec SDK | 0.8.1（v0.8.1 release） | Apache-2.0 | `libzvec_c_api` + core + ailego |
| intfloat/multilingual-e5-small | revision `614241f` | MIT | ONNX fp32，384 维 |
| ONNX Runtime（ort-sys 预编译） | 随 ort 2.0.0-rc.15 | MIT | 构建期下载，静态链接 |
| search-server | 本仓库 | 同仓库 | Rust 2021 |

升级 zvec 时必须同步更新：

- `Cargo.toml` 的 FFI 绑定（`src/zvec_ffi.rs`）与 `scripts/fetch-zvec-sdk.sh` 的版本/校验和；
- `Dockerfile` 的 `ZVEC_VERSION` / 两处 sha256；
- 重新跑 `cargo test`（含 zvec 往返测试）与本机 20 条查询基准。

## 8. 故障排查

| 现象 | 检查 |
| --- | --- |
| 502 / 连接拒绝 | 容器是否 running；`curl 127.0.0.1:17082/health`；端口是否被其它进程占用 |
| 启动即退出 | `docker logs`；索引缺失（先 build）；模型缺失（fetch-model.sh）；`libzvec_c_api.so` 未在 `LD_LIBRARY_PATH` |
| 搜索慢 / 首查 2s+ | 容器刚启动，索引段未驻留；观察 `tookMs`；必要时提高 `SEARCH_THREADS` |
| 客户端一直走 MiniSearch | 浏览器 Network 看 `/api/search` 状态；openresty location 是否精确匹配；CORS 预检是否被 WAF 拦 |
| 索引更新后结果不变 | 是否原子替换后重启；`/health` 的 `indexBuiltAt` 是否变化 |
