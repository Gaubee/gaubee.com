# hls-live-check — 线上 HLS 内容级验收

## 是什么

对 x.json 里 `videoLocal` 为 `.m3u8` 的条目抽样（默认最新 20 条，`--all` 全量，`--ids` 指定），直连源站核对三件事：

1. playlist：`GET /cdn-media/x/<月>/<id>.m3u8` → 200 + `application/vnd.apple.mpegurl` + 正文以 `#EXTM3U` 开头
2. 首段：`GET`（Range 0-0）`/cdn-media/x/<月>/<id>.seg0000.ts` → 206/200 + `video/mp2t`
3. 页面：含该 `.m3u8` 引用的事件文件对应的 `/pages/article/events/<name>` HTML 里确实出现该键

四态收据：`OK`（媒体与页面都对）｜`MEDIA_ONLY`（媒体可达、页面仍引用旧 mp4 → 等 `video-retro-hd --render-pending`）｜`UNPUBLISHED`（媒体未入卷且页面未引用 → 等 cron 第 4 步，正常过渡态）｜`BROKEN`（页面已引用但媒体不可达 → 真断链，exit 1）。

## 解决什么

R9：提交完成≠交付完成，部署收敛 + 媒体可达才闭环，且必须内容级验收而非只看 200（SPA 兜底会把任何路径都 200）。HLS 落地后「播放器代码 / 媒体对象 / 页面引用」三者分别经 CI、cdn-media 指针换代、cron 补渲染三条路上线，缺一条就是黑盒视频；本工具一条命令把三者对齐情况量化出来。

直连细节：`--noproxy '*'` 绕开 clash（否则 CONNECT 的 `200 Connection established` 头块会被误读成响应）、`--resolve` 钉源站 IP 绕开 fake-ip DNS 污染；头块解析跳过 1xx/CONNECT 取最后一个真实响应头。

## 怎么跑

```bash
bun tools/2026-10-21-hls-live-check/hls-live-check.ts                 # 最新 20 条
bun tools/2026-10-21-hls-live-check/hls-live-check.ts --all           # 全量
bun tools/2026-10-21-hls-live-check/hls-live-check.ts --ids 2111176930812998035
```

旗标：`--limit N` / `--all` / `--ids a,b` / `--host gaubee.com` / `--ip 39.107.213.167`。前置：curl。

## 真实示例输出（2026-10-21 01:5x，媒体尚未入卷的过渡态）

```
HLS 条目 89，本次核对 3（gaubee.com → 39.107.213.167）
  UNPUBLISHED 2111176930812998035  playlist 404/application/json 段 404/application/json 页面 未引用
  UNPUBLISHED 2105612568115155385  playlist 404/application/json 段 404/application/json 页面 无事件文件
  UNPUBLISHED 2105558891488739655  playlist 404/application/json 段 404/application/json 页面 未引用

收据：OK 0｜MEDIA_ONLY（待补渲染）0｜UNPUBLISHED（待入卷）3｜BROKEN 0
（exit 0）
```

预期：06:30 cron 入卷发布 + 推送 + `--render-pending` 后，同一命令应给出 OK 为主、BROKEN 0；若出现 MEDIA_ONLY 说明补渲染未跑或未部署收敛。
