# pipeline-completeness-audit — 每日管道「整条链是否都跑到」体检

## 是什么

按日核对六件事，逐日打勾：

| 列 | 判据 |
| --- | --- |
| 提交 | `data/sources/github-commits/changes/<date>.json` 存在 |
| GitHub 日报 | `reports/daily/<date>.md` 或已发布 `github-daily-<date>` event |
| X 日报 | `reports/daily/<date>-x.md` 或已发布 `x-daily-<date>` event |
| 媒体 | cdn-media 的 git log 里有该日补丁卷名（`patch-YYYY-MM-DD`）或 `📦 gen` 换代提交 |
| Graph | 站点 git log 里该窗口有 `📊` 提交 |
| 发布 | 该日两条日报的 event 至少存在一条 |

「提交 / GitHub 日报 / 媒体」缺失算硬缺口，退出码 1。

## 解决什么

`catchup-scan` 只看四源 changes 与双日报，管不到媒体入卷、Graph 同步、发布这些后半段——所以「日报写了但媒体没打包」「媒体打包了但没发布」这类半截状态测不出来。

2026-11-14 首跑就抓到真实事故：11-12 与 11-13 两轮 cron 整轮没跑，而 11-13 当时只有媒体与 Graph 有痕迹（因为 11-14 补抓的媒体卷与 Graph 重建覆盖了这两天），其余四项全空。硬缺口 2 项当场给出。

## 怎么跑

```bash
bun tools/2026-11-14-pipeline-completeness-audit/pipeline-completeness-audit.ts            # 近 7 天
bun tools/2026-11-14-pipeline-completeness-audit/pipeline-completeness-audit.ts --days 14
bun tools/2026-11-14-pipeline-completeness-audit/pipeline-completeness-audit.ts --from 2026-11-08 --to 2026-11-13
```

退出码：0 = 全绿；1 = 有硬缺口；2 = 目录缺失。纯只读（git log 只查不写）。

## 真实示例输出

2026-11-14 首跑（补跑前）：

```text
管道完整性 2026-11-08 .. 2026-11-13（提交 / GitHub 日报 / X 日报 / 媒体 / Graph / 发布）
  2026-11-08  ✓ ✓ ✓ ✓ ✓ ✓
  ...
  2026-11-13  · · · ✓ ✓ ·

硬缺口 2 项：
  - 2026-11-13 缺提交 changes
  - 2026-11-13 缺 GitHub 日报
```

补完两天后同一区间：

```text
  2026-11-12  ✓ ✓ ✓ ✓ ✓ ·
  2026-11-13  ✓ ✓ ✓ ✓ ✓ ·

PIPELINE OK：所选区间内提交、双日报、媒体入卷都有痕迹
```

## 判读建议

- 「发布」列是 `·` 不算缺口：报告还没发是正常中间态，发完自然变 ✓。
- 媒体列只认「卷名里有该日」或「有 gen 换代」。跨月回填的补丁卷名里没有该报告日，所以靠 `📦 gen` 兜住。
- 它查的是「有没有痕迹」，不查内容质量；内容质量靠 report-lint / 口径工具。
- 发现硬缺口后直接用 `backfill-plan` 生成补给命令，不要手算 run-date。
