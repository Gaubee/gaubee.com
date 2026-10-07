# x-media-audit — X 档案媒体库对账

## 是什么

一条命令核对 X (Twitter) 档案的媒体一致性（cdn-media Phase 3 语义，2026-10-07 重写）：
`x.json` 声明的本地引用（`mediaLocal`/`videoLocal`/`posterLocal`，canonical media key
`cdn-media/x/<月>/<文件>`）与 **manifest 对象集（已发布权威）∪ staging 磁盘（本地增量）**
对账：断链引用、staging 待打包/待清理/孤儿三态、本地化覆盖缺口、体积构成。零网络、跑完即退。

## 解决什么

- 权威存放 = GitHub Releases 卷（`cdn-media/manifest/manifest-<gen>.json` 对象集），
  本地不再有整库副本——引用是否都能在权威源兑现，此前只能靠肉眼。本工具把一致性变成可验证的。
- staging 会静默累积：抓取管道落盘后等 `media-pack --patch` 打卷，发布校验通过后按 7 天
  保留期清理。本工具区分「待打包」（引用已声明、卷未收录）与「待清理」（已入卷，可清理）。
- 断链 = 引用既不在 manifest、staging 也无副本（读者会 404）；孤儿 = staging 有文件但
  无引用无 manifest（下载后库存写入中断的残留）。
- 门禁语义：断链/孤儿任一硬问题退出码 1，可挂进日常维护流程；待打包/待清理/缺口只提示。
- 旧「git push 100MB 拒收线」门禁已随「媒体不进 git」（R6）一并废除——单文件体积上限
  由 media-pack 的单卷 200MiB 装箱硬限把守。

## 怎么跑

```sh
bun tools/2026-10-05-x-media-audit/x-media-audit.ts          # 在 skills/gaubee-skills/ 下执行，默认 Top10
bun tools/2026-10-05-x-media-audit/x-media-audit.ts --top 5  # 自定义榜单条数
```

数据根与站点根遵循既有约定：`GAUBEE_SKILLS_DATA`（缺省 `~/.gaubee-skills`）、
`GAUBEE_SITE`（缺省为仓库根；manifest 在 `<GAUBEE_SITE>/cdn-media/manifest/`，
staging 在 `<GAUBEE_SITE>/cdn-media/staging/x/`）。

## 示例输出（真实运行，2026-10-07 Phase 3 迁移日）

```sh
$ bun tools/2026-10-05-x-media-audit/x-media-audit.ts --top 5
# X 媒体库对账（manifest + staging，Phase 3 语义）
库存 3042 条动态（liked 2195 · posted 832 · bookmarked 15）· 待回灌 17 条
本地引用：图片条目 2284 · 视频条目 1142 ｜ 远程未本地化：图片 0 · 视频 0
manifest gen 2：3426 对象 · 3.22 GB（视频 1142）
staging：0 文件（待打包 0 · 0 B；待清理 0 · 0 B，发布校验通过后 7 天）

引用完整性：断链 0 ✓（缺失且 staging 无副本）｜ 待打包引用 0
staging 一致性：孤儿 0 ✓
本地化覆盖：全量已本地化 ✓
```

（退出码 0。隔离沙盒里实测过三态：staging 有副本未入卷 → 「待打包 N」；声明但从未下载 →
「断链」且退出码 1；孤儿文件 → 「孤儿」且退出码 1。）

## 状态

proposed（2026-10-05，等 kzf 裁决；2026-10-07 随 cdn-media Phase 3 重写对账语义）
