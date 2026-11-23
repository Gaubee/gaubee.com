# x-time0-migration — x/1970-01 错月对象存量迁移

## 是什么

一次性迁移：把 `x-posters.ts` 旧兜底逻辑打错的 847 个媒体对象（838 poster + 9 图）从
`x/1970-01/` 搬到它们的真实月份目录，用的是 append-only 方式——旧卷旧对象一律不动。

## 解决什么

`created_at` 缺失时旧代码兜底成 `1970-01`，于是这些对象落在错月 canonical key 上；
条目真实时间事后被归档/syndication 富化补全了，落盘键却不会自己改。
生成侧已修（兜底改运行日），本工具处理存量。

**这是 2026-10-09 的一次性迁移，正常情况下不需要再跑。**

## 怎么跑

```bash
# 预演（默认不写）
bun migrate-time0.ts
# 真写入（append-only，逐对象校验 sha256）
bun migrate-time0.ts --write
```

## 自托管部署

这个工具需要本地媒体卷与 manifest，**不在 gaubee.com 网页里运行**。

| 项 | 要求 |
| --- | --- |
| 依赖 | bun |
| 环境变量 | 无 |
| 需要的数据 | 本地 `cdn-media/manifest/`、已发布媒体卷、`x.json`、`src/content/events/` |

```sh
git clone https://github.com/Gaubee/gaubee-tool-x-time0-migration
cd gaubee-tool-x-time0-migration
bun run migrate-time0.ts   # 先预演，确认清单再 --write
```

> 注意：一次性迁移工具，通常不需要再跑；`--write` 前务必先预演核对。

仓库命名约定：`gaubee-tool-<slug>`（见 `openspec/changes/tool-body-economy`）。
