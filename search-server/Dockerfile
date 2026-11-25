# syntax=docker/dockerfile:1.7
#
# gaubee.com 语义搜索服务（zvec + E5-small ONNX）。
#
# 构建（必须在仓库根目录，原因：内容目录在 src/content）：
#   docker build -f search-server/Dockerfile -t gaubee-search-server .
#
# 镜像体积（linux/amd64 估算）：
#   debian:bookworm-slim   ~80 MB
#   search-server 二进制    ~35 MB（ONNX Runtime 静态链接）
#   zvec SDK so            ~102 MB（linux：libzvec_c_api + core + ailego + zvec）
#   E5-small ONNX 模型     ~448 MiB
#   索引 collection        ~22 MB
#   合计                   ~700 MB
# 若把 model/index 改为 compose volume 挂载，可降至 ~240 MB。
#
# 版本：zvec SDK v0.8.1（Apache-2.0）；模型 intfloat/multilingual-e5-small
# revision 614241f（MIT）；ONNX Runtime 由 ort-sys 在构建期下载（MIT）。

ARG RUST_VERSION=1.92
ARG ZVEC_VERSION=0.8.1

FROM rust:${RUST_VERSION}-bookworm AS builder

ARG ZVEC_VERSION
ARG TARGETARCH

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl libssl-dev pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# 先复制清单与源码；zvec SDK 需在 cargo build 前就位（build.rs 校验）。
COPY search-server/Cargo.toml search-server/Cargo.lock /build/
COPY search-server/build.rs /build/
COPY search-server/src /build/src
COPY search-server/scripts /build/scripts

RUN set -eux; \
    case "${TARGETARCH:-amd64}" in \
      amd64) ASSET="zvec-sdk-linux-amd64.tar.gz"; \
             SHA="cd4e4051b9baddb65896e73f2921a21e27fbf71711bd21eaedb58affaa93d1b9" ;; \
      arm64) ASSET="zvec-sdk-linux-arm64.tar.gz"; \
             SHA="12444390d1ce352c60b7b798ba6255e862255fb922d7ac23db791ec436b9f3a5" ;; \
      *) echo "unsupported TARGETARCH=${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    mkdir -p .cache/downloads .cache/zvec-sdk; \
    curl -fL --retry 3 -o ".cache/downloads/${ASSET}" \
      "https://github.com/alibaba/zvec/releases/download/v${ZVEC_VERSION}/${ASSET}"; \
    echo "${SHA}  .cache/downloads/${ASSET}" | sha256sum -c -; \
    tar -xzf ".cache/downloads/${ASSET}" -C .cache/zvec-sdk; \
    chmod +x scripts/*.sh

ENV ZVEC_SDK_DIR=/build/.cache/zvec-sdk \
    CARGO_TERM_COLOR=always

RUN cargo build --release --locked

# 模型 + 索引在构建期生成（离线运行期不需要外网）。
COPY search-server/scripts/fetch-model.sh /build/scripts/fetch-model.sh
RUN chmod +x scripts/fetch-model.sh \
    && MODEL_DIR=/build/.cache/models/multilingual-e5-small ./scripts/fetch-model.sh

COPY src/content/articles /build/content/articles
COPY src/content/events /build/content/events
RUN ./target/release/search-server build \
      --content /build/content \
      --index /build/index \
      --model-dir /build/.cache/models/multilingual-e5-small \
      --threads "$(nproc)"

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl libstdc++6 libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --home /app --shell /usr/sbin/nologin search

WORKDIR /app

COPY --from=builder /build/target/release/search-server /app/search-server
COPY --from=builder /build/.cache/zvec-sdk/lib /app/lib
COPY --from=builder /build/.cache/models/multilingual-e5-small /app/model
COPY --from=builder /build/index /app/index

ENV LD_LIBRARY_PATH=/app/lib \
    INDEX_DIR=/app/index \
    MODEL_DIR=/app/model \
    SEARCH_BIND=0.0.0.0:17081 \
    SEARCH_THREADS=4 \
    RUST_LOG=info

USER search
EXPOSE 17081

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:17081/health || exit 1

ENTRYPOINT ["/app/search-server"]
CMD ["serve"]
