# Tasks: tool-body-economy

## 1. 体力账本机制

- [x] 1.1 写 `scripts/lib/body-ledger.ts`：读写 `~/.gaubee-skills/tools/body-ledger.json`，
      提供 `readLedger()` / `recordOps(ops)` / `remainingToday()`；同日幂等（重跑不重复扣点）。
- [x] 1.2 超支拒绝逻辑：`recordOps` 校验 Σused+新操作用 ≤ 2，超出返回错误且不部分写入。
- [x] 1.3 单测：正常扣点、超支拒绝、同日重跑幂等、跨日额度重置。

## 2. 形态分类与迁移

- [x] 2.1 写 `tools/tool-form-audit`：扫描 `tools/2026-*` 与 REGISTRY，报缺 form、
      位置错放（internal 在 tools 下）、webapp 却读私有数据。
- [x] 2.2 给 REGISTRY 增加 `form` 列（webapp / self-hosted / internal / 空=待定）。
- [x] 2.3 逐个判定 96 个工具形态，产出 `tools/FORM-INVENTORY.md`（一张表：工具、form、理由、出口）。
- [x] 2.4 把 `internal` 的从 REGISTRY 摘出（移到 `tools/INTERNAL.md` 单独列，不计体力）。
- [x] 2.5 表里的 `webapp` 与 `self-hosted` 进入后续迁移。

## 3. 升级操作（今日不限体力）

- [ ] 3.1 ~~合并同类查询工具~~（暂缓：合并会删掉 kzf 可能仍在用的入口，等体力制跑顺后再按需 merge，见 SKILL.md §6 的 merge 形态）。
- [ ] 3.2 ~~删除被替代的工具~~（同上：无替代品就不删，税免机制靠形态分类已达成）。
- [x] 3.3 今天的结构性改造已记入账本（unlimited 模式，1 条 upgrade(merge)）。

## 4. WebApp 出口

- [x] 4.1 新增 `scripts/build-tools-index.ts`：从 REGISTRY + tools 目录产出
      `static/tools/index.json`（只公开字段）。
- [x] 4.2 新增 osapp `tools`（`/app/tools` + `/app/tools/<id>`），列表页 + 详情页。
- [x] 4.3 实现纯前端可跑的工具：`/app/tools/stars-search` 等 8 个（数据用 `static/tools/data/stars.json`）。
- [x] 4.4 `self-hosted` 详情页展示部署段落（依赖、`gaubee-tool-<slug>` 仓库名、命令）。
- [x] 4.5 站点构建通过（`pnpm content:prepare` + `pnpm check`）。

## 5. Go 化判定

- [x] 5.1 列出「值得 Go 重写」的工具清单与理由（需要常驻/大输入/二进制分发）。
- [x] 5.2 至少把 1 个这类工具真写成 Go，验证单二进制可跑（放 `tools-go/<slug>/`）。
- [x] 5.3 在 FORM-INVENTORY 里标注每个工具的「目标语言」。

## 6. 文档

- [x] 6.1 改 `SKILL.md` §6：工坊 = 每天 2 点体力 + 三档形态；`internal` 不占账本。
- [x] 6.2 改每日维护 runbook 第 8 步（定时任务 prompt 已更新为体力账本制 + 形态出口 + Go 优先）。
- [x] 6.3 `tools/REGISTRY.md` 头部说明增加 form 列与体力规则。

## 7. 验收

- [x] 7.1 `body-ledger-audit` 全绿（账本自洽）。
- [x] 7.2 `tool-form-audit` 全绿（无缺 form、无错放）。
- [x] 7.3 `static/tools/index.json` 生成且 WebApp 页面在本地 dev 下可打开。
- [x] 7.4 站点 `pnpm check` 无错。
- [x] 7.5 收尾：提交（显式路径）、推送、报告结果。

## 验收记录（2026-11-23）

| 项 | 结果 |
| --- | --- |
| `tool-form-audit` | TOOL FORM OK（96 个，internal 75 / webapp 12 / self-hosted 9） |
| `body-ledger-audit` | LEDGER OK（1 天记录，今日 unlimited） |
| 账本单测 | 5/5 通过（扣点/超支拒绝/同日幂等/跨日重置/merge 记 1 点） |
| `pnpm check` | 0 errors（3 warnings 为既有文件） |
| `pnpm build` | ✔ done，`build/tools/` 含 index.json + 三份数据 |
| 隐私审计 | 0 泄漏（私有仓 166 个已从 deps 投影剔除） |
| 线上验证 | `/tools/index.json` 8848B、`/tools/data/stars.json` 531KB、deploy-smoke 3 篇全过 |
| 容器部署 | 需手动重建（watchtower 报 Updated=0，见下） |

### 部署教训：watchtower 对手动 pull 过的新镜像不再重建

CI 推了新镜像后，服务器上 `docker pull` 会先拉到新的；watchtower 随后扫描时
本地已是最新 digest，于是反复报 `Updated=0`，容器一直跑旧镜像。
表现是「CI 绿但站点没更新」，容易误判成构建失败。
处置：`docker stop/rm` 后按原参数 `docker run` 重建一次（本次已做，站点已更新）。
