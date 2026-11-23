#!/bin/sh
# run-gaubeeos.sh — gaubeeos 容器的唯一启动入口（不要手拼 docker run）
#
# 为什么要有这个文件：容器不是 compose 起的，每次手动重建都要带齐
# 端口/挂载/watchtower 标签/env 文件四类参数。漏 tags 会让自动更新失效，
# 漏 env-file 会让 token 变空，两者都不立即可见（见 deploy/container-recreate.md）。
#
# 用法：sudo /etc/edge/gaubeeos/run.sh
set -eu

NAME=gaubeeos
IMAGE=ghcr.io/gaubee/gaubee.com:latest

docker pull "$IMAGE" >/dev/null 2>&1 || true
docker stop "$NAME" >/dev/null 2>&1 || true
docker rm "$NAME" >/dev/null 2>&1 || true

docker run -d --name "$NAME" --restart unless-stopped \
  -p 127.0.0.1:17080:8080 \
  -v /etc/edge/gaubeeos/config.toml:/config.toml:ro \
  -v /opt/gaubee/media-cache:/media-cache \
  --label com.centurylinklabs.watchtower=true \
  --label com.centurylinklabs.watchtower.enable=true \
  --env-file /etc/gaubeeos.env \
  "$IMAGE" >/dev/null

sleep 2
printf 'revision: '; docker inspect "$NAME" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
printf 'token len: '; docker inspect "$NAME" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^CDN_GITHUB_TOKEN=//p' | awk '{print length}'
printf 'status: '; docker ps --filter "name=$NAME" --format '{{.Status}}'
