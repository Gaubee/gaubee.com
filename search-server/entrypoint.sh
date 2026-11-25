#!/bin/sh
# search-server 容器入口：检查/重建 SQLite 索引后启动服务。
#
# 行为（对应部署手册）：
# 1. /data/index.sqlite 存在且内容指纹一致 → 直接 serve；
# 2. 缺失/内容变化 → 用 /app/content 调 magpie 重建；build 内部先写临时文件，
#    成功才原子替换，失败不会破坏旧索引；
# 3. 重建失败但有旧索引 → 用旧索引 serve 并告警；否则退出 1。
set -eu

INDEX_FILE="${INDEX_FILE:-/data/index.sqlite}"
CONTENT_DIR="${CONTENT_DIR:-/app/content}"
BUILD_ON_START="${BUILD_ON_START:-1}"

mkdir -p "$(dirname "$INDEX_FILE")"

if [ "$BUILD_ON_START" = "1" ]; then
    if /app/search-server check --content "$CONTENT_DIR" --index "$INDEX_FILE"; then
        echo "[entrypoint] index is up-to-date"
    else
        echo "[entrypoint] index missing or stale; building from $CONTENT_DIR ..."
        if /app/search-server build --content "$CONTENT_DIR" --index "$INDEX_FILE"; then
            echo "[entrypoint] index build complete"
        elif [ -f "$INDEX_FILE" ]; then
            echo "[entrypoint] WARN: index build failed; serving the previous index" >&2
        else
            echo "[entrypoint] ERROR: index build failed and no previous index exists" >&2
            exit 1
        fi
    fi
fi

exec /app/search-server serve \
    --index "$INDEX_FILE" \
    --bind "${SEARCH_BIND:-127.0.0.1:17082}"
