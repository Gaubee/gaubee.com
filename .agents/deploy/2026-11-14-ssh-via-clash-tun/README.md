# SSH 到香港源站连不上 — 本机 clash 全量走代理（2026-11-14 实证）

## 现象

北京机 2026-11-14 下线后，`ssh gaubee-cloud`（香港 47.82.76.102）失败：

```
debug1: Connection established.
debug1: Local version string SSH-2.0-OpenSSH_10.5
kex_exchange_identification: Connection closed by remote host
```

而站点侧一切正常：DNS 四源一致指香港、HTTPS 200、`deploy-smoke` 六篇新 event 全过、
媒体抽检与 HLS 全绿。同一时刻 `ssh -p 443 git@ssh.github.com` 是通的。

## 三个误导性观测（先记住，别再被它们带偏）

1. **`nc -vz 47.82.76.102 22` 报 succeeded 是假的**。clash 的 TUN（gVisor）
   在本地就接受了 TCP 握手，`nc` 拿到的是本地伪造的"连接成功"。
   判别方法：连一个**肯定没人监听**的端口（如 12345）——也报 succeeded，就说明是劫持。
2. **`nc -vz ... 443` 通不代表链路通**。443 能过是因为代理本身要连 443。
3. **"80 回 403" 也是代理给的**，不是服务器回的。

## 根因

clash Verge 运行时规则**只有一条**：

```
$ curl --unix-socket /var/run/clash-verge-service/users/502/verge-mihomo.sock \
       http://localhost/rules
total 1
  Match  -> PROXY
```

即全部流量、全部端口都交给代理，而该代理线路**封 22 端口**。所以：

- 香港服务器本身没有问题（`ssh` 绑物理网卡直连即刻通过）；
- GitHub 22 也同样失败——**跟服务器无关，是本机出站策略**；
- 换服务器、换端口、改防火墙都不会好转。

## 判据（怎么区分三种失败）

| 现象 | 含义 |
| --- | --- |
| `kex_exchange_identification: Connection closed by remote host`，且对端 port 22 | 中间层或对端拒 22（本例：代理封端口） |
| `Connection timed out during banner exchange` | 连上了但拿不到 banner（本例走 TUN 时的表现） |
| 连**任意**关闭端口都 `succeeded` | TUN 在本地伪造握手，`nc` 的结论全部作废 |

## 修法（不改全局代理规则，不需要 sudo）

`~/.ssh/bin/direct-nc.sh`：把出站 socket 绑到默认路由所在物理网卡的地址，
绕开 `utun*` 的 fake-ip 路由直连。`~/.ssh/config` 里：

```
Host gaubee-cloud
  HostName 47.82.76.102
  ProxyCommand ~/.ssh/bin/direct-nc.sh %h %p
```

脚本动态取默认网卡（`route -n get default` + `ipconfig getifaddr`），换了 Wi-Fi 也不用改。
实现在 `~/.ssh/bin/`，不进仓库（含本机网卡探测逻辑，属个人环境配置）。

修完当场验证：

```
$ bun tools/2026-10-30-ssh-channel-doctor/ssh-channel-doctor.ts
通道健康：可以跑 lag-watch / 服务器侧验收
$ bun tools/2026-10-15-manifest-lag-watch/manifest-lag-watch.ts
本地指针 gen：35 / 服务器 manifest gen：35（loaded=true）/ token 探针 HTTP 200
LAG WATCH OK：manifest 同步，token 健康
$ bun tools/2026-10-21-hls-live-check/hls-live-check.ts --limit 12
收据：OK 12｜BROKEN 0
```

## 遗留

- `clash` 的 `MATCH,PROXY` 兜底仍在（这是 kzf 自己的出站策略，未改）。
  任何**不走 22/25 等被封端口**的服务都经代理——对香港源站无影响（HTTPS 正常），
  但下次再出现"某个端口莫名连不上"，先按上表判定，别先怀疑服务器。
- 若希望所有到香港源站的流量都直连，可在 Verge 的 profile merge 里加
  `IP-CIDR,47.82.76.102/32,DIRECT,no-resolve`，但这是 kzf 的全局策略决定，未擅自改。
