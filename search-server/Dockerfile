# syntax=docker/dockerfile:1.7
#
# gaubee.com 语义搜索服务（SQLite FTS5 + 本地 llama.cpp embedding）。
#
# 构建（必须在仓库根目录，原因：内容目录在 src/content）：
#   docker build -f search-server/Dockerfile -t gaubee-search .
#
# 运行镜像只包含 debian:trixie-slim + search-server 二进制 + src/content + curl。
# 不装 llama.cpp、不带 GGUF 模型：embedding 由同机独立的 llama-server 提供
# （见 deploy/search-server.md 的 llama-server section），通过 loopback 访问。
#
# 索引策略：生产默认 BUILD_ON_START=0，索引在构建机上离线生成后挂载到 /data。
# 服务器只有 2 核，EmbeddingGemma 2 全量重建要 3 小时以上，不适合在容器启动时做。
#
# 体积估算（linux/amd64）：
#   debian:trixie-slim   ~80 MB
#   search-server 二进制 ~8–12 MB（rusqlite bundled + rustls）
#   src/content          ~13 MB
#   curl/ca-certificates ~8 MB
#   合计                 ~110–120 MB

ARG RUST_VERSION=1.92

FROM rust:${RUST_VERSION}-trixie AS builder

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

COPY search-server/Cargo.toml search-server/Cargo.lock /build/
COPY search-server/src /build/src
RUN cargo build --release --locked

FROM debian:trixie-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --home /app --shell /usr/sbin/nologin search \
    && mkdir -p /data \
    && chown -R search:search /data

WORKDIR /app

COPY --from=builder /build/target/release/search-server /app/search-server
COPY search-server/entrypoint.sh /app/entrypoint.sh
COPY src/content/articles /app/content/articles
COPY src/content/events /app/content/events

RUN chmod +x /app/entrypoint.sh && chown -R search:search /app

ENV INDEX_FILE=/data/index.sqlite \
    CONTENT_DIR=/app/content \
    EMBED_URL=http://127.0.0.1:18081 \
    EMBED_MODEL=embeddinggemma-2 \
    EMBED_PROMPTS=gemma2 \
    EMBED_TIMEOUT_MS=3000 \
    EMBED_BATCH_SIZE=16 \
    EMBED_CONCURRENCY=1 \
    EMBED_BUILD_TIMEOUT_MS=900000 \
    SEARCH_BIND=127.0.0.1:17082 \
    BUILD_ON_START=0 \
    RUST_LOG=info

USER search
EXPOSE 17082
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=30s --retries=3 \
    CMD curl -fsS http://127.0.0.1:17082/health || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
