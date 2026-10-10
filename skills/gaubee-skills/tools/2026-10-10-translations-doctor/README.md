# translations-doctor — X 译文覆盖率体检

## 是什么
一条命令输出 `translations/x-tweets.zh.json` 对 `x.json` 的覆盖全貌：总数、非中文正文
缺译数、按日缺口分布。供 cron 第 5 步译文增量前后各跑一次（前=找缺口，后=确认归零）。

## 解决什么
译文覆盖缺口拖了 4 天才被发现——cron 里这一步此前是「可选」，没有任何体检信号。
本工具与 `x-translations-export.ts`（导出）/`x-translations-merge.ts`（合并）配套，
不重复造轮子。

## 怎么跑
```bash
bun tools/2026-10-10-translations-doctor/translations-doctor.ts [--fail-when-missing]
```
`--fail-when-missing`：缺译数 > 0 退出 1（供 cron 门禁）。判定口径与 export 一致：
text 非空 且 译文缺失 且 原文非中文（中文原文不出译/原 toggle）。

## 真实示例输出（2026-10-10 实跑，译文增量合并后）
```
x.json 总条目 3072 · 已有译文 3060
非中文正文缺译：0
覆盖率完整：无待翻译条目
（exit 0）
```
缺译非 0 时追加「按日缺口分布」块与下一步指引。
