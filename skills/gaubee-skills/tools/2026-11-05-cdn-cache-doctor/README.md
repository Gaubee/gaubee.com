# cdn-cache-doctor — cdn-base 缓存与单飞滞留检测

## 是什么

读两次服务器 admin stats（间隔可配），把「在途预留」和「缓存水位」两个读数变成判据：`inflight_reserved` 非零且两次完全相同 → 判定单飞滞留（正常回源秒级完成，不会两次取值都一模一样地卡住）。另可从本地 manifest 抽真实对象做公网可达性验证，并对比本地/服务器 gen 提示 manifest 滞后。

## 解决什么

2026-11-04 的线上事故：新 volume 首次回源失败后，admission 预留与 per-key flight 锁未释放，`inflight_reserved` 卡在 4628372 字节不动，该对象之后**所有请求永久排队**（curl 150s 无响应）。当时是靠 hls-live-check 报 BROKEN 才发现的，排查花了几十分钟。本工具把「有东西卡住」变成 15 秒内可判定的探测。

## 怎么跑

```bash
bun tools/2026-11-05-cdn-cache-doctor/cdn-cache-doctor.ts --sample 2
bun tools/2026-11-05-cdn-cache-doctor/cdn-cache-doctor.ts --gap 30 --ssh gaubee-cloud
```

退出码：0 健康；1 滞留或抽样不可达；2 环境异常（附 hint）。

## 真实示例输出（2026-11-05 首跑）

```text
manifest gen=26 loaded=true objects=8463
缓存 0.49 GB / 上限 0.49 GB（2027 对象），inflight_reserved=0
预留为 0：无在途单飞
提示：缓存水位 100%，接近 high，新对象入缓存会先触发逐出
提示：本地指针 gen=27 高于服务器 gen=26——manifest 刷新窗口内属正常，持续滞后请跑 manifest-lag-watch
抽样 OK  x/2026-10/1995538384945664423-1.jpg → 200（0.31s）
抽样 OK  x/2026-07/2077806133230678428.seg0116.ts → 200（2.69s）
cdn-cache-doctor OK：无滞留，manifest 与缓存读数正常
```

滞留分支的处置提示：核实上游可达后重启静态服务容器清锁；若反复发生，需在回源失败分支补预留与锁的释放（服务端 `media.rs`，属独立工程）。

## 坑位备注

- ssh 的 stderr（post-quantum 警告等）绝不能混进 JSON——首版踩过，解析必然失败。
- 缓存水位长期贴 high 属常态（LRU 到 high 才逐出），只有 `undiscardable` 非零才值得警惕。
