# 容器重建备忘录（改完 gaubeeos 的 docker run 参数必看）

## 为什么需要这份备忘

`gaubeeos` 不是 compose 起的，是 `docker run` 直接跑的。任何一次手动重建
（`docker rm` + `docker run`）都要把下面这些参数**原样带齐**，漏一个就会出现
「站点更新了但内容没变」这种极难排查的现象。

## 必须带齐的参数

```sh
docker run -d --name gaubeeos --restart unless-stopped \
  -p 127.0.0.1:17080:8080 \
  -v /etc/edge/gaubeeos/config.toml:/config.toml:ro \
  -v /opt/gaubee/media-cache:/media-cache \
  --label com.centurylinklabs.watchtower=true \
  --label com.centurylinklabs.watchtower.enable=true \
  --env-file /etc/gaubeeos.env \
  ghcr.io/gaubee/gaubee.com:latest
```

## 三个已经踩过的坑

### 坑 1：漏了 watchtower 标签 → 自动更新彻底失效（2026-11-24）

watchtower 用 `--label-enable` 启动，**只监控带 `com.centurylinklabs.watchtower=true`
标签的容器**。重建时漏掉标签的后果：

- watchtower 日志显示 `Scanned=0`（不是 `Scanned=1 Updated=0`）
- 之后 CI 每次成功、容器也健康，但站点永远停在旧版本
- 排查时容易误判成「CI 没推镜像」或「watchtower 坏了」，实际只是容器不在监控名单里

**判据**：`docker logs watchtower | grep "Scanned="`。`Scanned=1 Updated=0` 是正常的
（镜像没变）；`Scanned=0` 就是标签丢了。

### 坑 2：手动 `docker pull` 过新镜像，watchtower 反而不重建

如果 CI 推了新镜像、又有人手动 `docker pull` 到本地，watchtower 下一次扫描会发现
本地 digest 已等于远端的，于是 `Updated=0`——但**容器仍在跑旧镜像**（pull 只更新了
本地镜像层，没有重建容器）。

**处置**：`docker stop/rm` 后按上面参数重建，然后核对
`docker inspect gaubeeos --format "{{index .Config.Labels \"org.opencontainers.image.revision\"}}"`，
它应该等于最新 commit 的前 40 位。

### 坑 3：从旧容器的 env 里抄 token → 抄成空串（2026-11-24）

重建时用 `docker inspect <旧容器> --format ... CDN_GITHUB_TOKEN` 取值，但**旧容器若已被
`docker rm`，就什么都取不到**，`-e CDN_GITHUB_TOKEN=""` 会悄悄把 token 清空。
后果不立即可见：manifest 靠公开指针仍能加载，但 release 回源与 token 探针会失败。

**正确做法**：token 与端口都在 `/etc/gaubeeos.env`，直接用 `--env-file` 引用，
既不从旧容器抄、也不写进命令行（避免进 shell 历史）。

## 重建后的三步验证

1. `docker inspect gaubeeos` 的 `org.opencontainers.image.revision` == 最新 commit
2. `curl https://gaubee.com/tools/index.json` 的 `count` 与本地 `static/tools/index.json` 一致
3. `docker logs watchtower | grep Scanned=` 必须是 `Scanned=1`
4. `docker inspect gaubeeos` 的 `CDN_GITHUB_TOKEN` 长度必须 > 0（93 左右），
   再跑 `manifest-lag-watch` 看 token 探针是否 200

## 更省事的做法

把启动参数写成 `/etc/edge/gaubeeos/run.sh`（或用 compose 文件），重建时直接执行它，
不再靠记忆拼参数。这一步还没做——下次重建前值得先补上。
