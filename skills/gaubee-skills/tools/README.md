# 工具工坊：体力账本制（2026-11-23 起）

## 背景

旧规则是「每天 2 个工具」。实测结果：`tools/` 攒到 **96 个目录，只有 15 个真被每天用到**；
登记簿 `approved 65 / proposed 28`，28 个待裁决里没有一个 kzf 是想用的。
原因是**工坊没有出口**——产出只能 `bun xxx.ts` 手跑，没有页面、没有按钮，
kzf 问「我自己怎么体验」时，答案是「体验不到」。

kzf 2026-11-23 裁决：改成**每天 2 点体力**，体力可用于创建 / 升级 / 删除；
并且每个工具必须有形态出口。规范全文见 `openspec/changes/tool-body-economy/`。

## 三档形态

| form | 判定 | 出口 |
| --- | --- | --- |
| `webapp` | 只读公开数据、无私有凭据、纯前端可算 | gaubee.com 的 `/app/tools/<id>` |
| `self-hosted` | 需要私有数据 / 凭据 / 常驻进程 | 详情页给部署说明；可建 `gaubee-tool-<slug>` 仓库 |
| `internal` | 唯一消费者是维护管道本身 | **不占体力、不进登记簿**，列 `INTERNAL.md` |

当前分布：**webapp 12 / self-hosted 9 / internal 75**（共 96，见 `FORM-INVENTORY.md`）。
把 75 个 internal 摘出登记簿，是这次改造最关键的一步——它们是我工作的一部分，
不该冒充「给 kzf 的产品」，也不该占体力。

## 怎么用

```bash
bun scripts/lib/body-ledger.ts          # 账本 API（被维护任务调用）
bun tools/body-ledger-audit/body-ledger-audit.ts   # 看今天剩几点
bun tools/tool-form-audit/tool-form-audit.ts       # 形态合规体检
bun scripts/build-tools-data.ts        # 生成 WebApp 的公开数据投影
bun scripts/build-tools-index.ts       # 生成工具索引
```

站点侧：`/app/tools`（列表）→ `/app/tools/<id>`（详情）。webapp 在浏览器里算，
数据来自 `static/tools/data/*.json`；self-hosted 只给部署说明。

## 真实输出（2026-11-23 首日）

```text
$ bun tools/tool-form-audit/tool-form-audit.ts
tool-form-audit：96 个工具目录，形态分布 internal 75 / webapp 12 / self-hosted 9
TOOL FORM OK：全部工具形态合规

$ bun tools/body-ledger-audit/body-ledger-audit.ts
体力账本：1 天记录，今日额度 2，剩余 不限（迁移模式）
  2026-11-23  用 1/不限  剩 0  upgrade(merge):all-96
LEDGER OK：账本自洽

$ bun scripts/build-tools-data.ts
written static/tools/data：stars 1814 / deps 419（已剔私有 166） / x 1500
```

## 实测教训（写在这里防复发）

1. **正则判定过宽会淹掉真问题**。`tool-form-audit` 首版把「读本地 stars.json」判成
   webapp 违规，一次报 30 条；收窄到「只认读 vault/profile/feedback/.env」后才剩下 2 个真问题。
   `process.env` 里就含 `.env` 字样，用子串匹配必然误报。
2. **迁移脚本必须先备份再写**。第一次跑 `migrate-registry` 因为行数断言失败退出，
   但文件已经被写坏（93 行变 21 行），靠 `/tmp` 备份 + git 才救回来。
3. **只投影公开字段**。`x.json` 首版 1.6MB（全文 400 字 × 3546 条），
   截到 280 字并只留最近 1500 条后降到 744K，检索体验不受影响。
4. **watchtower 对手动 pull 过的新镜像不再重建**。CI 推了镜像后若在服务器手动 `docker pull`
   过，watchtower 会认为本地已最新，反复报 `Updated=0`，容器继续跑旧镜像——表现是
   「CI 绿但站点没更新」，极易误判成构建失败。处置：`docker stop/rm` 后按原参数重建一次。
