#!/bin/sh
# search-server 容器入口：校验索引后启动服务。
#
# 行为（对应部署手册）：
# 1. BUILD_ON_START=0（生产默认）：只 check 不重建。索引在构建机上离线生成后
#    挂载到 /data；服务器只有 2 核，EmbeddingGemma 2 全量重建要 3 小时以上。
# 2. BUILD_ON_START=1：缺失/内容变化 → 用 /app/content 调 embedding 后端重建；
#    build 内部先写临时文件，成功才原子替换，失败不会破坏旧索引。
# 3. 重建失败但有旧索引 → 用旧索引 serve 并告警；否则退出 1。
#
# check 现在同时校验内容指纹、向量空间身份（模型+前缀）与结构完整性，损坏的
# 索引不会被放过（否则 serve 加载失败会让容器陷入崩溃循环）。
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
else
    # BUILD_ON_START=0：索引不匹配就明确失败，不带病 serve。
    echo "[entrypoint] ERROR: index missing or stale and BUILD_ON_START=0." >&2
    echo "[entrypoint] 离线重建（在构建机或本机跑）：" >&2
    echo "  search-server build --content $CONTENT_DIR --index $INDEX_FILE" >&2
    echo "  然后把生成的 index.sqlite 放到挂载的 /data 目录。" >&2
    exit 1
fi

exec /app/search-server serve \
    --index "$INDEX_FILE" \
    --bind "${SEARCH_BIND:-127.0.0.1:17082}"
