# x-archive-coverage — X 归档覆盖对账（posted/reposted 维度）

## 是什么

xd-window-audit（10-23）管 liked 的「恰一窗」日报维度；本工具管 posted/reposted 的归档维度：x.json 这两类条目按推文本地日聚合，逐日核对站点 `x-archive-<date>.md` 是否存在。缺档与孤档双侧报告。

## 真实示例输出（2026-10-29 首跑，exit 1）

```text
x.json posted/reposted 共 834 条、分布 497 天；站点归档 1306 天
缺档 3 天：
  2026-10-02（5 条）
  2026-10-03（3 条）
  2026-10-04（1 条）
无源孤档 812 天（库存无对应 posted/reposted，可能曾删或口径调整）：
  2015-08-18
  2016-06-27
  …
```

## 判读（2026-10-29 人工核验）

- **缺档 3 天是真缺口**：10-02～10-04 的 9 条 posted/reposted 是后来回灌进 x.json 的，归档生成器当时没有重跑。修复路径：`bun scripts/x-archive-events.ts` 全量重写（按设计会自动补这三天，并跳过已有日期）。是否执行留 kzf 裁决（涉及新增 3 个归档 event 的发布）。
- **孤档 812 天是历史口径差异，非缺陷**：站点归档有 1306 天，其中 812 天的 posted/reposted 不在现 x.json 库存——远古动态来自官方 Data Archive 回灌时代，其条目形态与现行 kind 标记不同；部分早期归档还承载过方案 a 之前的 liked 落点。这些是已发布历史卷，按「不动已发布」保留，本工具如实报出以便人工理解口径，不应据此重写历史。

## 怎么跑

```bash
bun tools/2026-10-29-x-archive-coverage/x-archive-coverage.ts
```

退出码：0 双侧对齐；1 有缺口（缺档或孤档任一）。
