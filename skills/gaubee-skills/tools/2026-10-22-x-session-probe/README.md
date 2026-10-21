# x-session-probe — X 会话健康探针（抓取前置早警）

## 是什么

在每日 X 抓取前花几秒确认 ego-browser 的 x.com 登录态：打开书签页、等 8 秒、按最终 URL 与页面证据判定。三种退出码：

- `0` 健康：有推文 article 且页面带本账号导航（最终页可能是 X 重定向后的 /i/history，2026-10-22 实测，不看路径看证据）
- `1` 会话失效：被重定向到登录流（`/login`、`/i/flow`、`/i/jf/onboarding`、`mode=login` 任一），提示先登录
- `2` 未知：页面形态不在预期内，输出最终 URL / article 数 / body 前 200 字供人工判断

## 解决什么

2026-10-21 早晨发现 ego-browser 的 x.com 会话已过期：三条流抓不到时间线，旧判定把登录墙误报成「no-timeline」，结果整天 X 数据缺失、日报缺一天，靠人工对账才发现。本探针把「会话活着吗」变成抓取前的第一个门禁，失效即刻早警，避免带病跑管道。

顺带沉淀的实测事实：X 把 `/i/bookmarks` 重定向到 `/i/history`（登录态正常时也会）；登录流地址是 `/i/jf/onboarding/web?redirect_after_login=…&mode=login`（旧的 `/login`、`/i/flow` 之外的新形态）。

## 怎么跑

```bash
bun tools/2026-10-22-x-session-probe/x-session-probe.ts
```

前置：ego-browser（登录过 x.com 的浏览器态）。一次运行只开一个 page、跑完即退、零常驻。建议挂在 `x-likes-fetch.ts` 之前：exit 1 时跳过抓取先登录。

## 真实示例输出（2026-10-22）

会话健康（重定向到 /i/history 的形态）：

```
会话健康：已登录（7 条推文 article，最终页 https://x.com/i/history）
（exit 0）
```

会话失效（2026-10-21 实录，同形态下判定为登录流）：

```
会话失效：书签页被重定向到登录流（https://x.com/i/jf/onboarding/web?redirect_after_login=%2Fi%2Fbookmarks&mode=login）——请在 ego-browser 登录 x.com 后重跑抓取
（exit 1）
```

实测细节：ego 宿主把脚本 console.log 混进 stderr，探针从两个流里找 PROBE 行。
