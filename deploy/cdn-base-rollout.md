# cdn-base 上线部署顺序（存量服务器，2026-10-06 起生效）

> 适用前提：镜像 tag ≥ 含 cdn-base 模块的构建（`4efd84d3` 起）。新二进制把
> `config.toml` 作为启动硬依赖（缺失/非法**启动即败**，fail-fast 是契约 A9），
> 因此必须先完成本清单再拉新镜像。Watchtower 自动更新在完成本清单并验证前保持关闭。

## 前置一次性准备（服务器上）

```sh
# 1. 配置文件（从仓库样例拷贝后按需修改；不要把 token 写进文件，用 env 注入）
sudo mkdir -p /opt/gaubee
sudo cp /path/to/repo/static-server/config.example.toml /opt/gaubee/config.toml
# 2. 缓存目录：镜像以 UID 65532 运行（scratch 无 shell 不能 exec chown，必须宿主预置）
sudo mkdir -p /opt/gaubee/media-cache
sudo chown -R 65532:65532 /opt/gaubee/media-cache
# 3. 剩余空间 ≥ high×1.2（high 默认 500MB，即 ≥600MB）
df -h /opt/gaubee/media-cache
```

## compose 变更点（对照仓库 docker-compose.yml）

- `volumes:` 追加 `/opt/gaubee/config.toml:/config.toml:ro`（只读挂载，不进镜像）
- `volumes:` 追加 `/opt/gaubee/media-cache:/media-cache`（bind mount，缓存持久化）
- `ports:` 追加 `127.0.0.1:8081:8081`（admin 仅宿主 loopback 可达；**公网反代拒绝转发 8081**）

## 验证顺序（每步通过再下一步）

1. `docker compose config` —— 确认 config 是文件挂载、缓存是 bind mount、8081 只绑 loopback
2. `docker compose pull && docker compose up -d` —— 启动失败时看日志修复指令
   （常见：config 缺字段 / 缓存目录不可写 / 剩余空间不足）
3. `curl localhost:8080/healthz` → 200；`curl localhost:8081/cdn-media-admin/stats` → JSON
4. `curl -o /dev/null -w '%{http_code}' localhost:8080/cdn-media-admin/stats` → **404**（公网面隔离）
5. 冷拉一个媒体对象：`curl -H 'Accept-Encoding: gzip' -D - localhost:8080/cdn-media/x/<某对象>` 
   → 200、**无 content-encoding**、`cache-control: public, max-age=31536000, immutable`
6. Range：`curl -r 0-99 -D - -o /dev/null <同 URL>` → 206 + 正确 Content-Range
7. 重启容器 → `stats` 的 objects 不归零（缓存持久化生效）
8. 外层反代把 `cdn-media.gaubee.com` 指到 8080（Host 路由），公网全链路复验 5/6

## 回滚

镜像回退到上一个 digest（`docker compose` 里 pin digest），旧二进制不读 config.toml，
但已挂载的卷无害；config/缓存目录保留，下次升级复用。

## 观察（上线后 24h）

反代日志回源错误率、`stats` 的 `poisoned_active`/`undiscardable`/`inflight_reserved`
三字段（应长期为 0/极少）、磁盘水位（LRU 逐出日志）。
