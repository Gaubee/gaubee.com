# event-date-anchor — 报告类 event 日期锚定修复

## 是什么
扫描 `src/content/events` 的报告类 event（slug 含 x-daily / github-daily /
signals-weekly / signals-monthly / signals-yearly），把 date 统一锚定到「报告日」：
日报取 slug 里的 YYYY-MM-DD，周报取标题窗口「～<周日>」的末日（缺则按 ISO 周推算），
月报/年报取月末日 / 12-31。frontmatter 缺失时补齐（title/tags 按类型推导）。
默认 dry-run，`--execute` 写盘；幂等，可重复跑。

## 解决什么
kzf 2026-10-14 裁决（R8）：报告跟随对应当天，不随操作日漂移。存量盘点发现两类漂移：
publish.ts「直通」bug 剥掉 frontmatter（01818~01830 九份，date 落 1970、最近列表
沉底）；手写时代 date=发布时刻（10 份，比报告日晚一天）。首跑一次修复 19 处。

## 怎么跑
```bash
bun tools/2026-10-14-event-date-anchor/event-date-anchor.ts            # dry-run
bun tools/2026-10-14-event-date-anchor/event-date-anchor.ts --execute  # 落盘
```
退出码恒 0（盘点类工具，无失败态；数据缺失以输出行呈现）。

## 真实示例输出（2026-10-14 实跑，dry-run 节选）
```
改 date 00024.github-daily-2026-10-02.md：2026-10-03T16:00:46.126Z → 2026-10-02
补 frontmatter 01828.x-daily-2026-10-12.md：title="X 日报：2026-10-12" date="2026-10-12" tags=["event","signals","x"]
改 date 01826.signals-weekly-W41.md：2026-10-12T00:53:21.205Z → 2026-10-11
dry-run：19 处待修（加 --execute 落盘）
```
execute 后复跑：`dry-run：0 处待修`。
