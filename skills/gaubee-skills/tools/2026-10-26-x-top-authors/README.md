# x-top-authors — X 点赞作者榜

## 是什么

从 `x.json` 聚合 kind=liked 条目按作者计数，回答「我最近总在赞谁」。默认最近 30 天窗口（`--days 0` 看全库），输出 top N 作者、条数与最近互动日期。纯本地秒级，零网络零写入。

## 解决什么

X 日报看的是「哪天赞了什么」，没有「长期在赞谁」的聚合视图。作者榜是信号档案里最便宜的一层兴趣画像：连续上榜的作者就是值得主动关注的信源，而不只是时间线里的过客。

## 怎么跑

```bash
bun tools/2026-10-26-x-top-authors/x-top-authors.ts                 # 最近 30 天 top 10
bun tools/2026-10-26-x-top-authors/x-top-authors.ts --days 0 --top 20
```

## 真实示例输出（2026-10-26 首跑，exit 0）

```text
最近 30 天 liked 228 条（库存 liked 共 2355），top 10 作者：
  @bkdgiffug  7 条  最近 2026-10-22
  @unixzii  5 条  最近 2026-10-23
  @NFT_Chen  5 条  最近 2026-10-17
  @bunjavascript  4 条  最近 2026-10-22
  @davidhaz  4 条  最近 2026-10-18
  …
```

## 判读

30 天 228 条赞里头部 10 位作者占 38 条（约 1/6），集中度不高但头部稳定（@unixzii、@bunjavascript、@shadcnlabs、@jarredsumner 都是 TS 工程主线信源）；@bkdgiffug 以 7 条居首，属中文 AI 工具资讯类账号——值得单独立一份「主动关注清单」的信号。
