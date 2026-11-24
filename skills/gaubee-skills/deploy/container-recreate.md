# gaubeeos 部署：compose 化与三个事故的完整根因

## 现状（2026-11-24 起）

`gaubeeos` 由 **compose** 管理（`/etc/edge/gaubeeos/docker-compose.yml`），
自动更新由 **cron + `auto-update.sh`** 负责，**watchtower 已停用并禁止自启**。

```sh
# 重建（唯一入口）
cd /etc/edge/gaubeeos && sudo docker compose up -d
# 手动触发一次更新
sudo /etc/edge/gaubeeos/auto-update.sh
# 自检
docker inspect gaubeeos --format 'revision={{index .Config.Labels "org.opencontainers.image.revision"}}'
docker inspect gaubeeos --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^CDN_GITHUB_TOKEN=//p' | awk '{print length}'
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:17080/
```

## 事故一：watchtower 用「新建容器替换」的方式升级，与固定端口冲突

**这是最根本的问题，之前一直没看出来。**

watchtower 的升级机制是：发现新镜像 → **新建一个容器** → 删掉旧的。
但 `gaubeeos` 绑定 `127.0.0.1:17080`，旧容器还占着端口时，新容器启动必然失败：

```
Error response from daemon: driver failed programming external
connectivity: Bind for 127.0.0.1:17080 failed: port is already allocated
```

后果是**每 5 分钟留下一个 `Created` 状态的僵尸容器**。2026-11-24 排查时发现
**56 个僵尸**，全部从 22:56 起累积。同时 watchtower 日志是 `Failed=1 Scanned=1 Updated=0`，
看起来像「什么都没发生」。

**判据**：`docker ps -a --filter ancestor=ghcr.io/gaubee/gaubee.com:latest --format '{{.Names}} {{.Status}}'`
出现一堆 `Created` 就是这个问题。

**修法**：改用 `docker compose pull && docker compose up -d`——compose 会原地替换容器，
不会出现两个容器抢同一端口。watchtower 已 `docker update --restart=no` + 停用。

## 事故二：重建时漏 watchtower 标签（已被事故一的修法消解）

watchtower 以 `--label-enable` 启动，只监控带 `com.centurylinklabs.watchtower.enable=true`
的容器。手动重建漏了标签 → 日志 `Scanned=0`（不是 `Scanned=1`）→ 永远不更新。

现在 compose 文件里写死了标签，且已不用 watchtower，此坑不再适用；
但**保留这条记录**：如果将来重新启用 watchtower，必须先确认标签在位。

## 事故三：从已删容器抄 token 抄成空串

`docker inspect <旧容器>` 取 token，但旧容器已被 `rm`，取到空串，
`-e CDN_GITHUB_TOKEN=""` 把 token 清空。症状**极隐蔽**：manifest 靠公开指针仍加载成功
（日志显示 gen 正常），但 token 探针 401、release 回源失败。

**修法**：token 与端口都在 `/etc/gaubeeos.env`，compose 用 `env_file` 引用，
既不从旧容器抄、也不进命令行。

## 事故四：`/app/tools` 返回 200 但打不开（应用没被安装）

完全不是部署问题，是客户端逻辑：

`AppManager.init()` 只对**首次访问**（localStorage 为空）安装 `DEFAULT_APP_IDS`。
老用户的 localStorage 里没有 `tools`，于是：
- `/app/tools` 走 SPA fallback 返回 200（看起来"上线了"）
- 但应用根本没安装 → 桌面看不到、路由也进不去

`skill-graph` 当年踩过同一个坑。修法是在 `runDefaultAppMigrations` 加一条
`{ id: "tools", tag: "add-tools@2026-11-24" }`，老用户首次访问后一次性补装。

**判据**：`curl /app/tools` 返回 4556B（SPA 壳）+ 桌面看不到图标 = 应用未安装，
不是部署问题。代码注释里记录了同一坑（`AppManager.svelte.ts:311`）。

## 排查这些问题时最容易走的弯路

我这次走过两条：

1. **把「容器在跑但没更新」误判成「容器没在跑」**。`docker ps --filter ancestor=...`
   在某些时刻返回空，但实际有容器在另一个名字下运行。要用
   `docker ps -a --format '{{.Names}} {{.Status}} {{.Ports}}' | grep 17080`
   按端口反查。
2. **把「SPA 返回 200」当成「页面可用」**。所有 `/app/*` 都返回同样的 4563B 壳，
   必须用浏览器实际渲染才知道应用有没有装上。
