# patch-precheck — cdn-media 同日补丁卷闸门预检器

## 是什么
cron 第 4 步 `media-pack --patch` 的前置预检：按「staging 未入卷文件按月分组 → 今日卷名
`patch-<月>-<DD>.tar` 是否已被当前代 manifest 引用」判定今日哪些月份组能安全打包。

## 解决什么
同名卷不可变闸门（A2）连续两天在 cron 里 fail-closed（10-09 撞 patch-2023-04-09、
10-10 撞 patch-2026-10-10），每次都导致 X 日报被迫停发。预检把「跑到一半才死」变成
「动手前就知道」。

## 怎么跑
```bash
bun tools/2026-10-10-patch-precheck/patch-precheck.ts [--date YYYY-MM-DD]
```
退出码：0 = 全部安全；1 = 存在会撞名的组；2 = 参数非法。同名卷存在但未被引用
（崩溃残留）不算撞，media-pack 会确定性重打包覆盖。判定口径与 media-pack 一致
（staging canonical key 不在当前代 objects 即为新增；manifest-5 起 objects 为数组）。

## 真实示例输出（2026-10-10 实跑）
```
打包日 10 号 · 当前 manifest-5（208 卷）
✗ 撞名  2026-10：11 个新文件 → patch-2026-10-10.tar（同名卷已被 manifest 引用，今日该组 --patch 将 fail-closed，建议改日）
PRECHECK FAIL：1 个月份组今日会撞名，建议改日或先入卷其它组
（exit 1）
```
与当天 media-pack --patch 实跑的 fail-closed 结果一致（同 11 文件、同撞名卷）。
