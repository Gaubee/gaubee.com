# avatar-healthcheck — 作者头像 URL 健康抽查

## 是什么
对 authors.json 的 pbs.twimg.com 头像 URL 做等距抽样 HEAD 检查，报告失效数与失效
作者清单，并给出 `x-media-backfill.ts --ids` 重富化指引（upsert 以新值覆盖）。

## 解决什么
X 用户换头像后旧 URL 失效，归档卡片裂图（实证 2026-10-11：@irsyad 换头像，01707
旧 URL 已 404，靠当日富化 upsert + 重渲染自愈）。此前没有任何工具能提前发现这类失效。

## 怎么跑
```bash
bun tools/2026-10-11-avatar-healthcheck/avatar-healthcheck.ts [--sample N] [--fail-on-dead]
```
`--sample N`：等距抽样数（默认 60，0 = 全量；全量是对 pbs.twimg.com 的数千请求，慎用）。
`--fail-on-dead`：检出失效退出 1（cron 门禁用）。退出码：0 = 存活或未启用门禁。

## 真实示例输出（2026-10-11 实跑）
```
authors.json 1045 位作者 · 抽样 HEAD 40 个头像 URL
失效：0
（exit 0）
```
