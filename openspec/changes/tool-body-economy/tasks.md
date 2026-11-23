# Tasks: tool-body-economy

## 1. 体力账本机制

- [ ] 1.1 写 `scripts/lib/body-ledger.ts`：读写 `~/.gaubee-skills/tools/body-ledger.json`，
      提供 `readLedger()` / `recordOps(ops)` / `remainingToday()`；同日幂等（重跑不重复扣点）。
- [ ] 1.2 超支拒绝逻辑：`recordOps` 校验 Σused+新操作用 ≤ 2，超出返回错误且不部分写入。
- [ ] 1.3 单测：正常扣点、超支拒绝、同日重跑幂等、跨日额度重置。

## 2. 形态分类与迁移

- [ ] 2.1 写 `tools/tool-form-audit`：扫描 `tools/2026-*` 与 REGISTRY，报缺 form、
      位置错放（internal 在 tools 下）、webapp 却读私有数据。
- [ ] 2.2 给 REGISTRY 增加 `form` 列（webapp / self-hosted / internal / 空=待定）。
- [ ] 2.3 逐个判定 96 个工具形态，产出 `tools/FORM-INVENTORY.md`（一张表：工具、form、理由、出口）。
- [ ] 2.4 把 `internal` 的从 REGISTRY 摘出（移到 `tools/INTERNAL.md` 单独列，不计体力）。
- [ ] 2.5 表里的 `webapp` 与 `self-hosted` 进入后续迁移。

## 3. 升级操作（今日不限体力）

- [ ] 3.1 按形态判定结果执行合并：把同一类查询工具折成少数几个（如星标类 → 一个 `repo-lookup`）。
- [ ] 3.2 删除已被合并/替代的工具（目录保留，REGISTRY 标 `retired` 并注明 replacedBy）。
- [ ] 3.3 每个合并/删除写进账本（今日 unlimited 模式，仍记录操作以便明天起算正常）。

## 4. WebApp 出口

- [ ] 4.1 新增 `scripts/build-tools-index.ts`：从 REGISTRY + tools 目录产出
      `static/tools/index.json`（只公开字段）。
- [ ] 4.2 新增 osapp `tools`（`/app/tools` + `/app/tools/<id>`），列表页 + 详情页。
- [ ] 4.3 实现至少 1 个纯前端可跑的工具（`repo-lookup`，用 `static/skill-graph/data.json`）。
- [ ] 4.4 `self-hosted` 详情页展示部署段落（依赖、`gaubee-tool-<slug>` 仓库名、命令）。
- [ ] 4.5 站点构建通过（`pnpm content:prepare` + `pnpm check`）。

## 5. Go 化判定

- [ ] 5.1 列出「值得 Go 重写」的工具清单与理由（需要常驻/大输入/二进制分发）。
- [ ] 5.2 至少把 1 个这类工具真写成 Go，验证单二进制可跑（放 `tools-go/<slug>/`）。
- [ ] 5.3 在 FORM-INVENTORY 里标注每个工具的「目标语言」。

## 6. 文档

- [ ] 6.1 改 `SKILL.md` §6：工坊 = 每天 2 点体力 + 三档形态；`internal` 不占账本。
- [ ] 6.2 改每日维护 runbook 第 8 步（定时任务 prompt）。
- [ ] 6.3 `tools/REGISTRY.md` 头部说明增加 form 列与体力规则。

## 7. 验收

- [ ] 7.1 `body-ledger-audit` 全绿（账本自洽）。
- [ ] 7.2 `tool-form-audit` 全绿（无缺 form、无错放）。
- [ ] 7.3 `static/tools/index.json` 生成且 WebApp 页面在本地 dev 下可打开。
- [ ] 7.4 站点 `pnpm check` 无错。
- [ ] 7.5 收尾：提交（显式路径）、推送、报告结果。
