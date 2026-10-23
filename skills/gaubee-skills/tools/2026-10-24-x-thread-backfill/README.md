# x-thread-backfill — X 线程兜底工具化

## 是什么

把 runbook 里「🧵 或 n/m 标记但 entry.thread 缺失时，用 ego-browser 打开推文页抓同作者全链写回」的人工兜底步变成 CLI。两种模式：

- **扫描**（默认）：列库存里疑似缺链的条目（正文带 🧵 或 n/m 序号且无 `thread` 字段）
- **抓链**（`--ids a,b`）：逐条用 ego-browser 打开推文页，收集**同作者**的 status 链（剔除引用/转发的外人推文），按页面 DOM 顺序对齐正文，原子写回 `x.json` 的 `entry.thread`

## 解决什么

捕捉 v2 的浏览器抽取只拿到线程中的一条，线程全貌靠 syndication 实体链接走链补——但实体链缺失时只有 cron 里的人工简报兜底，没有工具。首跑实证：库存 3193 条里 18 条已有链、**36 条疑似缺链**（含 DeepSeek 1/6 线程、bobzhang 的 🧵 等真实损失）。

## 怎么跑

```bash
bun tools/2026-10-24-x-thread-backfill/x-thread-backfill.ts                  # 扫描
bun tools/2026-10-24-x-thread-backfill/x-thread-backfill.ts --ids 2097930608790167907
```

## 真实示例输出

扫描（2026-10-24，exit 0）：

```text
库存 3193 条；已有 thread 18 条；疑似缺链 36 条
  2107380840846045239 2026-10-06 @mylifcc 标记="🧵" https://x.com/mylifcc/status/2107380840846045239
  2097930608790167907 2026-09-10 @deepseek_ai 标记="1/6" https://x.com/deepseek_ai/status/2097930608790167907
  …
```

抓链（DeepSeek 1/6 线程实抓，exit 0）：

```text
  2097930608790167907：写回 6 段（@deepseek_ai）
已原子写回 /Users/kzf/.gaubee-skills/data/sources/x-likes/x.json（改 1 条）
```

复核：6 段 id 连续递增（2097930608…→2097930627…），末段「🌐 支持开源。扩展部署选项。」正是线程收尾；调试版曾把引用推文 UnslothAI 也收进链，已修为同作者过滤。

## 实现注记

- ego-browser API 约定同 x-session-probe：`taskSpace()` + `newPage()`，console.log 混 stderr 双流找 GRAB 行。
- `Bun.spawnSync` 不经 shell——脚本内容必须直接作 `-e` 参数，`$(cat …)` 命令替换不会被展开（首跑失败根因）。
- 写回用 `scripts/lib.ts` 的 `writeFileAtomic` + 1 空格缩进，与 x-likes-fetch 序列化格式一致，不产生全文件重排。
