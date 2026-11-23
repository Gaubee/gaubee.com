# tool-body-economy Capability Delta

## ADDED Requirements

### Requirement: 体力账本

工具工坊必须（SHALL）以「每日 2 点体力」代替「每日 2 个工具」作为产出单位。每点体力可执行一次
`create`（新建）、`upgrade`（升级，含 merge / split / rewrite）、或 `delete`（下线）操作。

体力跨日不累积、不结转、不拍卖；当日未用完的部分如实记为 `unused`，不补到次日。

账本必须（SHALL）落在私有数据根：`~/.gaubee-skills/tools/body-ledger.json`，结构为
`{ version, days: [{ date, budget, used: [{op, tools, reason, artifacts}], unused }] }`，
且只追加、不改历史日。

#### Scenario: 正常消费

- WHEN 某日维护任务执行 1 次 `upgrade`
- THEN 账本该日记 `used` 1 条、`unused` 1，次日额度仍为 2

#### Scenario: 超支被拒

- WHEN 一次运行内第 3 个操作被尝试
- THEN 该操作被拒绝，账本只记前 2 个，并返回「今日体力已用完」错误

#### Scenario: 同日重跑幂等

- WHEN 同一日期因补跑再次进入维护任务
- THEN 沿用当日已有记录，不重复扣点，`unused` 不因重跑而变化

#### Scenario: 合并只记 1 点

- WHEN 把多个工具合并成一个（`upgrade` 的 merge 形态）
- THEN 仍只计 1 点体力，被合并工具在登记簿标 `merged-into:<id>`

### Requirement: 工具形态为必填字段

每个登记在册的工具必须（SHALL）有 `form` 字段，取值 `webapp` | `self-hosted` | `internal`。

`internal` 判定标准是其唯一消费者为每日维护任务本身；这类工具**不占体力、不进登记簿**，
归入维护管道组件（`scripts/` 或 `tools/internal/`）。

`webapp` 必须（SHALL）只读公开数据、无私有凭据、纯前端可计算。
`self-hosted` 必须（SHALL）提供部署前置（依赖/凭据/数据）、启动命令与配置说明，
并允许以 kzf 身份创建 `gaubee-tool-<slug>` 仓库承载自托管版本。

#### Scenario: 内部件不计账本

- WHEN `report-facts-check` 被判定为 `internal`
- THEN 它从登记簿与体力账本中移除，位置可留在原处，但不再计入工坊产出

#### Scenario: 缺 form 被审计拦下

- WHEN 某个工具登记在册但缺 `form`
- THEN `tool-form-audit` 报错并列出该工具

#### Scenario: webapp 却读私有数据

- WHEN 标注为 `webapp` 的工具读取了 `~/.gaubee-skills` 下的私有数据
- THEN `tool-form-audit` 报错（违反形态契约）

### Requirement: WebApp 出口

站点必须（SHALL）提供 osapp `tools`，路由 `/app/tools`（列表）与 `/app/tools/<id>`（详情），
只列出 `form=webapp` 的工具；`form=self-hosted` 的工具同页出现但详情页展示自托管部署说明。

WebApp 必须（SHALL）纯前端运行，不向服务端发起数据请求。

工具索引必须（SHALL）由 pipeline 生成到 `static/tools/index.json`，只含公开字段：
`id` / `name` / `summary` / `form` / `version` / `updatedAt` / `dataNeeds`。

#### Scenario: 纯前端搜索

- WHEN 用户在 `/app/tools/repo-lookup` 输入关键词
- THEN 匹配在浏览器内基于 `static/skill-graph/data.json` 完成，不发服务端请求

#### Scenario: 自托管说明

- WHEN 用户打开一个 `form=self-hosted` 工具的详情页
- THEN 页面给出依赖、仓库名 `gaubee-tool-<slug>`、安装与启动命令，且不提供在线运行入口

#### Scenario: 索引只含公开字段

- WHEN `static/tools/index.json` 被生成
- THEN 其中不出现私有仓名、本地绝对路径、token 或任何 `~/.gaubee-skills` 内容

### Requirement: 升级由上游变化驱动

工具必须（SHALL）声明数据源依赖（`dataNeeds`: `stars` / `x` / `deps` / `graph` / `none`）。

当上游发生结构性变化（仓库改名、仓库删除、README 大改、数据 schema 变更）时，
受影响工具进入「待升级」队列，可按体力执行 `upgrade`。

结构性变化的检测必须（SHALL）复用现有审计工具（`rename-similarity-audit`、
`stars-integrity-audit`、`report-facts-check` 等），不新造检测机制。

#### Scenario: 改名触发升级

- WHEN 某工具检索的仓库被改名（如 `pgx` → `pgboxdb`）
- THEN 该工具进入待升级队列，下次体力可执行 `upgrade` 更新其数据与文档

#### Scenario: 收藏新增驱动升级

- WHEN 每日收藏新增了该工具覆盖领域的新仓库
- THEN 工具可被 `upgrade` 以纳入新数据；是否执行由当日体力决定

### Requirement: Go 优先与分发

需要服务端能力、常驻进程、或适合单二进制分发的工具必须（SHALL）优先采用 Go 实现，
产物为静态链接单二进制。

已有 TypeScript 工具**不强制重写**：系统必须（SHALL）只在 `upgrade` 时顺带迁移，
不得为语言而无谓重写。

站点侧不执行 Go：Go 工具通过 `gaubee-tool-<slug>` 仓库的 release 分发，
WebApp 只提供安装与运行说明。

#### Scenario: Go 工具分发

- WHEN 某 self-hosted 工具用 Go 实现
- THEN 其仓库 release 提供各平台单二进制，WebApp 详情页给出下载与 `go install` 两种方式

#### Scenario: TS 工具不被迫重写

- WHEN 一个 TS 工具行为正确且无需服务端能力
- THEN 它可以保持 TS，仅在未来的 `upgrade` 中按需迁移
