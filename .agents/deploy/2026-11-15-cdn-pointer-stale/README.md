# cdn-media 子仓忘推 → 服务器指针停摆（2026-11-15 实证）

## 现象

`manifest-lag-watch` 报 `服务器 gen-35 落后本地 gen-36`。
服务器侧 `loaded_at` 比当前时间早 10 小时以上，而 `refresh_interval_secs` 只有 300——
说明刷新**一直在跑但每次都拿到旧的**，不是刷新坏了。

## 排查顺序（按这个顺序走，最快定位）

1. **先看服务器读的是什么**：`docker inspect gaubeeos` 找挂载，读出 `config.toml` 的
   `manifest.current_url`（它是 `https://gaubee.com/cdn-media-pointer/manifest/current.json`，
   不是 GitHub，也不是本地文件）。
2. **再问这个 URL 现在返回什么**：从服务器自身 curl 它。
   若返回旧 gen，问题在指针镜像，不在容器。
3. **看镜像的 HEAD**：`sudo git -C /srv/cdn-media-pointer log --oneline -1`。
4. **手动 pull 一次**。若 `Already up to date` 但 gen 还是旧的 → **远端根本没有新提交**
   （本次就是这个）。若 pull 报 `SSL_ERROR_SYSCALL` / `Empty reply` → 是到 github.com 的通道问题。

## 根因

本次两层叠加：

- **主因：cdn-media 子仓的提交没有 push**。主仓 `git add cdn-media` 只更新了 gitlink 并提交主仓，
  子仓自己的 commit 还停在本地 `ahead 1`。指针镜像从远端拉，自然看不到 gen 36。
- **诱因：服务器的 `git pull` 连续失败**。`/var/log/cdn-media-pointer-pull.log` 全是
  `OpenSSL SSL_connect: SSL_ERROR_SYSCALL in connection to github.com:443` 与
  `Empty reply from server`；`cdn-media-pointer.timer` 也已在 2 天前停摆（`NEXT n/a`）。
  事后实测 `curl https://github.com/` 是 200，属间歇性故障。

两层叠起来的效果：即使 push 了，也可能要等下一次通道恢复才追上。

## 修法

```sh
# 1. 在子仓里推（这是漏掉的一步）
cd <site>/cdn-media && git push origin main

# 2. 服务器侧立即拉（不必等 timer）
ssh gaubee-cloud 'sudo git -C /srv/cdn-media-pointer pull --ff-only origin main'

# 3. 确认公网指针换代
ssh gaubee-cloud 'curl -s https://gaubee.com/cdn-media-pointer/manifest/current.json | python3 -c "import json,sys;print(json.load(sys.stdin)[\"gen\"])"'

# 4. 等容器刷新（refresh_interval_secs=300，实测 4 个轮询周期内跟上）
```

## 判据：容器没跟上 ≠ 媒体没发布

- 媒体对象是否真的在 Releases：`media-pack --publish` 的终验会逐个核对 size/digest，绿了就是发布了。
- 服务器没跟上时，**新对象仍可通过 admin 直连验证**，只是走 `/cdn-media/...` 会 404。
- 所以 `lag-watch` 红的时候，先分清是「对象没发」还是「指针没跟」——这次的 `--publish`
  终验是绿的（290 卷一致），纯粹是指针滞后。

## 防复发建议

- 每轮管道收尾必须确认子仓 `git status -sb` 不显示 `ahead N`。主仓 gitlink 更新**不会**顺带推子仓。
- `cdn-media-pointer.timer` 的 `NEXT n/a` 是一个早期信号：timer 死了还有 cron 兜底，但 cron 日志
  里的 pull 失败通常没人看。建议把 pull 失败次数纳入 lag-watch 的提示（当前未实现，记在这里）。
