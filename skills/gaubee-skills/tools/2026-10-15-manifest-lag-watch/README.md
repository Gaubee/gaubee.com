# manifest-lag-watch — 服务器交付滞后早警

## 是什么
对比「本地 cdn-media 子仓 current.json 的 gen」与「服务器 cdn-base admin stats 的
manifest gen」，滞后即 FAIL（给出落后区间与影响面：gen-7 起对象公网 404）；顺带
从服务器 compose 取 token（值不出服务器）对 api.github.com/rate_limit 做一次认证
探针，401 即 token 失效。只读；服务器上不留任何东西。

## 解决什么
2026-10-14 媒体 404 事故实证：token 失效后服务器对远程 manifest 的刷新静默失败，
靠本地缓存回退停在 gen-6（线上已 gen-8/9），直到新日报引用新对象才以 404 暴露。
deploy-smoke 在公网侧兜底（要等页面引用到不可见对象才响），本工具在服务器侧更早
报警，适合 cron 第 4 步后、发布前跑一次作门禁。

## 怎么跑
```bash
bun tools/2026-10-15-manifest-lag-watch/manifest-lag-watch.ts [--ssh gaubee-cloud]
```
退出码：0 = 同步且 token 健康；1 = 滞后或 token 失效；2 = 用法异常。

## 真实示例输出（2026-10-15 实跑，token 待换的当下）
```
本地指针 gen：9
服务器 manifest gen：6（loaded=true）
FAIL 滞后：服务器 gen-6 落后本地 gen-9（gen-7 起的对象公网 404）
token 探针（rate_limit 认证）：HTTP 401
FAIL token 失效或缺失——manifest 刷新与 release 回源都会失败（换新 token 并 up -d）
LAG WATCH FAIL：2 项
```
token 换新后复跑应转全绿。
