#!/bin/sh
# search-server 容器入口：校验索引后启动服务。
#
# 行为（对应部署手册）：
# 1. 索引与镜像内内容、当前模型身份完全一致 → 直接 serve。
# 2. BUILD_ON_START=1：内容变化就重建（写临时文件，成功才原子替换，失败不破坏旧索引）。
# 3. BUILD_ON_START=0（生产默认）：
#    - 索引结构完整但内容/模型过期 → **先服务旧索引**并告警，等后台 index-sync 重建。
#      这条很关键：auto-update 每 5 分钟可能因新镜像重建容器，若此时拒绝启动会崩溃循环。
#    - 索引缺失或损坏 → 退出 1（serve 加载不了，重试没有意义）。
#
# check 同时校验内容指纹、向量空间身份（模型+前缀）与结构完整性；--allow-stale
# 只放宽「内容/模型过期」，结构损坏仍然失败。
set -eu

INDEX_FILE="${INDEX_FILE:-/data/index.sqlite}"
CONTENT_DIR="${CONTENT_DIR:-/app/content}"
BUILD_ON_START="${BUILD_ON_START:-0}"

mkdir -p "$(dirname "$INDEX_FILE")"

if /app/search-server check --content "$CONTENT_DIR" --index "$INDEX_FILE"; then
    echo "[entrypoint] index is up-to-date"
elif [ "$BUILD_ON_START" = "1" ]; then
    echo "[entrypoint] index missing or stale; building from $CONTENT_DIR ..."
    if /app/search-server build --content "$CONTENT_DIR" --index "$INDEX_FILE"; then
        echo "[entrypoint] index build complete"
    elif [ -f "$INDEX_FILE" ]; then
        echo "[entrypoint] WARN: index build failed; serving the previous index" >&2
    else
        echo "[entrypoint] ERROR: index build failed and no previous index exists" >&2
        exit 1
    fi
elif /app/search-server check --content "$CONTENT_DIR" --index "$INDEX_FILE" --allow-stale; then
    echo "[entrypoint] WARN: index is valid but stale; serving it until index-sync rebuilds" >&2
else
    echo "[entrypoint] ERROR: index is missing or corrupt (BUILD_ON_START=0)." >&2
    echo "[entrypoint] 离线重建（在构建机或本机跑）：" >&2
    echo "  search-server build --content $CONTENT_DIR --index $INDEX_FILE" >&2
    echo "  然后把生成的 index.sqlite 放到挂载的 /data 目录。" >&2
    exit 1
fi

exec /app/search-server serve \
    --index "$INDEX_FILE" \
    --bind "${SEARCH_BIND:-127.0.0.1:17082}"
