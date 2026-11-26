#!/bin/sh
# index-sync.sh — 让线上索引追上镜像内内容（发布后自动执行）。
#
# 触发链：日报发布 → CI 重建 gaubee-search 镜像（内含新 src/content）
#        → 服务器 auto-update 每 5 分钟拉镜像并重建容器
#        → 本脚本每 10 分钟检查一次：镜像内容比索引新就做**增量**重建。
#
# 安全边界：
# - 只做增量；新算 chunk 超过 MAX_NEW_CHUNKS 直接放弃并告警（服务器 2 核，
#   全量重建是小时级，必须回构建机做）。
# - 索引结构损坏不尝试自愈，退出等人工处理。
# - 重建失败保留旧索引，线上继续用旧索引（entrypoint 的 --allow-stale）。
set -eu

COMPOSE_DIR="${COMPOSE_DIR:-/etc/edge/gaubeeos}"
MODELS_DIR="${MODELS_DIR:-/opt/gaubee/search-models}"
IMAGE="${IMAGE:-ghcr.nju.edu.cn/gaubee/gaubee-search:latest}"
SERVICE="${SERVICE:-search-server}"
EMBED_URL="${EMBED_URL:-http://127.0.0.1:18081}"
EMBED_MODEL="${EMBED_MODEL:-embeddinggemma-2}"
EMBED_PROMPTS="${EMBED_PROMPTS:-gemma2}"
MAX_NEW_CHUNKS="${MAX_NEW_CHUNKS:-300}"
LOCK_FILE="${LOCK_FILE:-/var/lock/gaubee-search-index.lock}"
SIDECAR="$MODELS_DIR/index.source"

log() { echo "$(date '+%F %T') $*"; }

# 同一时间只允许一个实例（cron 10 分钟一次，重建可能 3 分钟）。
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
    log "another run is in progress; skip"
    exit 0
fi

cd "$COMPOSE_DIR"

log "pull $SERVICE image"
docker compose pull --ignore-pull-failures "$SERVICE" >/dev/null 2>&1 || true

IMG_ID=$(docker image inspect --format '{{.Id}}' "$IMAGE" 2>/dev/null || true)
if [ -z "$IMG_ID" ]; then
    log "ERROR: image $IMAGE not present"
    exit 1
fi

if [ -f "$SIDECAR" ] && [ "$(cat "$SIDECAR")" = "$IMG_ID" ]; then
    log "index already built from this image ($IMG_ID); nothing to do"
    exit 0
fi

# embedding 服务必须在线，否则重建一定失败。
if ! curl -sf -m 5 "$EMBED_URL/health" >/dev/null 2>&1; then
    log "ERROR: embedding service $EMBED_URL is not healthy"
    exit 1
fi

run_check() {
    docker run --rm -v "$MODELS_DIR:/data:ro" --entrypoint /app/search-server \
        "$IMG_ID" check --content /app/content --index /data/index.sqlite "$@"
}

if run_check >/tmp/index-sync-check.log 2>&1; then
    log "index content matches image; record image id"
    printf '%s\n' "$IMG_ID" >"$SIDECAR"
    exit 0
fi

if ! run_check --allow-stale >/tmp/index-sync-stale.log 2>&1; then
    log "ERROR: index is corrupt or missing; refusing to auto-rebuild"
    tail -5 /tmp/index-sync-stale.log | sed 's/^/  /'
    exit 1
fi

log "index is stale; incremental rebuild (max new chunks: $MAX_NEW_CHUNKS)"
# 先留上一代；build 内部写临时文件、成功后原子替换 --index，失败不碰旧索引。
cp -f "$MODELS_DIR/index.sqlite" "$MODELS_DIR/index.sqlite.prev"
if ! docker run --rm --network host --user 0:0 \
    -v "$MODELS_DIR:/data" \
    --entrypoint /app/search-server \
    "$IMG_ID" build \
        --content /app/content \
        --index /data/index.sqlite \
        --embed-url "$EMBED_URL" \
        --embed-model "$EMBED_MODEL" \
        --embed-prompts "$EMBED_PROMPTS" \
        --embed-batch-size 4 \
        --embed-concurrency 1 \
        --timeout-ms 900000 \
        --max-new-chunks "$MAX_NEW_CHUNKS" \
    >/tmp/index-sync-build.log 2>&1; then
    log "ERROR: rebuild failed; keeping the old index"
    tail -8 /tmp/index-sync-build.log | sed 's/^/  /'
    exit 1
fi

grep -E "索引构建完成|增量重建" /tmp/index-sync-build.log | sed 's/^/  /'

# build 已原子替换 index.sqlite；只补权限与侧文件。
chmod 644 "$MODELS_DIR/index.sqlite" "$MODELS_DIR/index.sqlite.prev"
printf '%s\n' "$IMG_ID" >"$SIDECAR"

log "restart $SERVICE to load the new index"
if [ "${SKIP_RESTART:-0}" = "1" ]; then
    log "SKIP_RESTART=1: 跳过容器重启（测试模式）"
    exit 0
fi
docker compose restart "$SERVICE" >/dev/null 2>&1

# 等 health（最多 90 秒）。
for _ in $(seq 1 30); do
    if curl -sf -m 3 http://127.0.0.1:17082/health >/dev/null 2>&1; then
        log "done; search-server healthy"
        exit 0
    fi
    sleep 3
done

log "WARN: search-server did not become healthy within 90s"
exit 1
