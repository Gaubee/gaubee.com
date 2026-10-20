# x-posters-backfill — 视频 poster 覆盖审计与回灌（文件 + x.json 接线 + 重渲染）

## 是什么

两档：
- `audit`（默认）：扫 `src/content/events/*.md` 全部 `<video>` 标签，统计带/缺 poster 数并列缺口样例（只读，缺口非零 exit 1）。
- `--fill-local`：对缺 poster 的条目做三件事——①封面文件：staging 已有 `<id>-poster.jpg` 直接用，没有就从 staging 的 `<id>-video.mp4` 或 `<id>.m3u8`（HLS 分片）ffmpeg 抽 0.5s 首帧写回 staging；staging 无视频副本但 manifest 已有该封面对象的只接线；②接线：x.json 该条 `posterLocal` = canonical key（渲染器只认这个字段）；③重渲染涉及日期（`scripts/lib/x-rerender.ts`，`--no-render` 可跳过）。

## 解决什么

当日新视频常缺 poster → 站点视频卡片黑盒（01841 实证）。x-posters.ts 只在下载时点生成，历史缺口无人补。本工具先把缺口量化（首跑：1202 视频缺 78），再回灌。

**首版教训（2026-10-20 同日补课）**：首版只写封面文件、没接线 `posterLocal`，README 里「重渲染时由生成器补上」是错的——渲染器从不扫目录。结果 30 张封面在 x-media-audit 里被判成「孤儿」（无引用无 manifest），页面上也一张没出现。补上接线 + 重渲染后覆盖从 1124 升到 1157。

## 怎么跑

```bash
bun tools/2026-10-20-x-posters-backfill/x-posters-backfill.ts                        # 审计
bun tools/2026-10-20-x-posters-backfill/x-posters-backfill.ts --fill-local           # 审计+回灌+接线+重渲染
bun tools/2026-10-20-x-posters-backfill/x-posters-backfill.ts --fill-local --no-render
```

前置：ffmpeg（软依赖，抽帧失败按跳过计）。封面文件在 staging，待 media-pack --patch 入卷；x.json 原子写回。剩余缺口 = 本地无视频副本且 manifest 无封面的条目（真源只在 Releases），需先用 media-pack 取回视频再抽帧。

## 真实示例输出（2026-10-20 → 21）

audit（首跑）：

```
<video> 总数 1202｜带 poster 1124｜缺 poster 78
  缺口样例：2108557062359941589（01824.x-daily-2026-10-11.md）
  ...
AUDIT：缺口 78（--fill-local 可回灌：staging 有视频副本的抽帧，manifest 已有封面的只接线）
（exit=1）
```

--fill-local（补接线版）：

```
<video> 总数 1205｜带 poster 1124｜缺 poster 81

回灌收据：抽帧 3｜接线 posterLocal 33｜跳过（无副本无封面/抽帧失败/条目缺失）29｜涉及日期 9
  重渲染日报 2026-10-11（run-date 2026-10-12）：exit 0
  ...（共 8 个日报日 + 归档全量重写，全部 exit 0）
封面文件在 staging，待 media-pack --patch 入卷；poster 属性已随重渲染写入事件文件。
```

复核：

```
<video> 总数 1205｜带 poster 1157｜缺 poster 48
```
