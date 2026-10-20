# x-posters-backfill — 视频 poster 覆盖审计与回灌

## 是什么

两档：
- `audit`（默认）：扫 `src/content/events/*.md` 全部 `<video>` 标签，统计带/缺 poster 数并列缺口样例（只读，缺口非零 exit 1）。
- `--fill-local`：对缺 poster 且视频文件恰好还在 `cdn-media/staging/x/` 的条目，ffmpeg 抽 0.5s 首帧写 `<id>-poster.jpg` 回 staging（canonical key 布局），staging 无副本的跳过（真源在 Releases）。

## 解决什么

当日新视频常缺 poster → 站点视频卡片黑盒（01841 实证）。x-posters.ts 只在下载时点生成，历史缺口无人补。本工具先把缺口量化（首跑：1202 视频缺 78），再把 staging 还留有副本的部分直接回灌（首跑填了 48 张）。

## 怎么跑

```bash
bun tools/2026-10-20-x-posters-backfill/x-posters-backfill.ts             # 审计
bun tools/2026-10-20-x-posters-backfill/x-posters-backfill.ts --fill-local # 审计+本地回灌
```

前置：ffmpeg（软依赖，抽帧失败按跳过计）。回灌文件在 staging，待 media-pack --patch 入卷；事件文件的 poster 属性在下次归档/日报重渲染时由生成器补上。

## 真实示例输出（2026-10-20）

audit：

```
<video> 总数 1202｜带 poster 1124｜缺 poster 78
  缺口样例：2108557062359941589（01824.x-daily-2026-10-11.md）
  ...
AUDIT：缺口 78（--fill-local 可回灌本地 staging 有副本的部分；真源在 Releases 的需先 media-pack 下载）
（exit=1）
```

--fill-local：

```
回灌收据：填充 48｜跳过（staging 无副本或抽帧失败）30
回灌文件在 staging，待 media-pack --patch 入卷后由生成器输出 poster 属性。
（exit=0）
```
