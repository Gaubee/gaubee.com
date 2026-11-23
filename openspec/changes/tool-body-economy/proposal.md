# Change: 工具工坊改为「体力账本」，并给工具定三档形态出口

## Why

kzf 2026-11-23 提出三点问题，本质是同一个：**工坊没有出口，所以产出变成了堆积。**

现状实测（2026-11-23）：

- `tools/` 下 **96 个目录**，其中只有 **15 个**被 `scripts/daily-auto.ts` 调用。
- 登记簿 **approved 65 / proposed 28**，28 个待裁决里没有一个 kzf 是想用的——因为最近两周的产出
  全是 agent 自己排障时做的内部件（`report-facts-check`、`late-star-backfill`、`site-endpoint-doctor` …）。
- 工具只能 `bun xxx.ts` 手跑，**没有网站页面、没有按钮、没有 MCP 入口**。
  kzf 问「我自己怎么体验」，答案是：他体验不到，只能通过我汇报里的一句话知道它们存在。

kzf 的原话：

> 改成每天有 2 个"体力"，体力可以用来"创建"、"升级"、"删除"。
> 其中升级比较特殊，可以将多个合并成一个或者将一个拆分成多个或者更加复杂的混合模式。

以及三个最终目的：

1. **持续迭代优化**：工具基于每日收藏/点赞，上游变了（例如仓库改名、README 更新）就要跟着升级。
2. **能部署的直接部署成 gaubee.com 的 WebApp**；并且优先用 Go 写（省内存与磁盘）。
3. **不能部署的**，在 WebApp 里留一份 self-hosted 部署说明（允许用 kzf 身份建 `gaubee-tool-xxx` 仓库）。

## What Changes

### A. 体力账本取代「每天 2 个」

- 每天 2 点体力，跨日**不累积**（今天不用就作废），由当日维护任务消费。
- 三类操作各计 1 点：`create`（新建）、`upgrade`（升级/合并/拆分）、`delete`（下线）。
  - `upgrade` 的合并把多个工具折成一个仍记 1 点——这是刻意设计：鼓励减少条目而不是增加。
- 账本落 `~/.gaubee-skills/tools/body-ledger.json`（私有，不进 git），每日一条记录：
  日期、消耗点数、操作清单（op/toolIds/理由/产物路径）。
- 未用完的体力如实记 `unused`，不补到明天。

### B. 每个工具必须有「形态」（form）

| form | 含义 | 出口 |
| --- | --- | --- |
| `webapp` | 只读公开数据、纯前端可跑 | gaubee.com 的 osapp（`/app/<id>`） |
| `self-hosted` | 需要私有数据/凭据/常驻进程 | WebApp 里给部署说明 + `gaubee-tool-<slug>` 仓库 |
| `internal` | 只服务维护管道本身 | 不进工坊账本，归 `scripts/` 或 `tools/internal/` |

关键判定：**`internal` 不再消耗体力、不再进登记簿**。它们是我工作的一部分，
不是我给 kzf 的产品。这条是本次改造的核心——把三分之二的历史包袱从账本里摘出去。

### C. WebApp 出口

- 站点 `src/lib/apps/installable/` 新增工具类 osapp，按 `AppEntry` 契约注册（`/app/tools`）。
- 数据来自站点已有的公开投影（`static/skill-graph/data.json`）与新增的工具公开索引
  （`static/tools/index.json`，由 pipeline 生成，只含公开字段）。
- 纯前端计算：搜索、过滤、排序、时间线都在浏览器里跑，不发服务端请求。

### D. Go 优先

- 需要服务端/CLI 的工具用 Go 写，产物单二进制，静态链接。
- 站点侧不跑 Go（站点是 Rust + Svelte 静态）；Go 工具通过 self-hosted 仓库分发，
  WebApp 只放说明与 `go install` / release 下载链接。
- 已有的 TS 工具不强制重写：**只在「升级」时顺带迁移**，避免为了语言而无谓重写。

## Impact

- 新增：体力账本机制、工具形态分类、`/app/tools` WebApp、`static/tools/index.json`。
- 修改：`SKILL.md` §6 工坊 playbook（从「每天 2 个」改为「每天 2 点体力 + 三档形态」）、
  每日维护 runbook 第 8 步。
- 迁移：96 个工具全部定形态；`internal` 摘出登记簿；`webapp` 逐个挂上站点；
  `self-hosted` 补部署说明。
- 不动：`cdn-media` 契约、报告发布链、隐私红线。

## 非目标

- 不把 96 个工具全部 Go 重写（只在升级时顺带）。
- 不做服务端执行用户提交的代码（WebApp 全是纯前端）。
- 不改已有 approved 65 个的状态（它们的形态在迁移中标注，状态保持）。
