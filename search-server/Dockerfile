# syntax=docker/dockerfile:1.7
#
# gaubee.com 语义搜索服务（SQLite FTS5 + magpie 远程 embedding）。
#
# 构建（必须在仓库根目录，原因：内容目录在 src/content）：
#   docker build -f search-server/Dockerfile -t gaubee-search .
#
# 运行镜像只包含：debian:trixie-slim + search-server 二进制 + src/content + curl。
# 不下载 zvec/ONNX/模型；索引在容器启动时按需通过 magpie 构建到 /data。
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
    BUILD_ON_START=1 \
    SEARCH_BIND=127.0.0.1:17082 \
    MAGPIE_URL=https://magpie.aiweb.xin \
    MAGPIE_EMBED_MODEL=mistral-embed \
    EMBED_BATCH_SIZE=48 \
    EMBED_CONCURRENCY=4 \
    MAGPIE_BUILD_TIMEOUT_MS=180000 \
    MAGPIE_TIMEOUT_MS=2000 \
    RUST_LOG=info

USER search
EXPOSE 17082
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=45m --retries=3 \
    CMD curl -fsS http://127.0.0.1:17082/health || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
