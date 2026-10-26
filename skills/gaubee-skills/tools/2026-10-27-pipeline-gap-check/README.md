# pipeline-gap-check — 每日管道漏跑门禁

## 是什么

一条命令回答「某天的管道是否全绿跑完」：核对四个源的 changes 是否有当日记录（commits 按报告日、其余源按运行日命名，与脚本实际口径一致），以及双日报 event 是否已发布。任一缺口 exit 1。`--date` 可回查任意历史日。纯本地秒级。

## 解决什么

2026-10-21 X 会话失效导致整天 X 数据缺失，靠人工对账次日才发现；本工具把「漏跑早警」固化成绿门——每天跑一次（或补漏任务跑），缺口当日可见而不是三天后写周报时发现。

## 怎么跑

```bash
bun tools/2026-10-27-pipeline-gap-check/pipeline-gap-check.ts                  # 昨天为报告日
bun tools/2026-10-27-pipeline-gap-check/pipeline-gap-check.ts --date 2026-10-26
```

## 真实示例输出（2026-10-27 首跑，发布前）

```text
报告日 2026-10-26（运行日 2026-10-27）：
  星标：changes 3 条
  提交：changes 3 条
  依赖：changes 0 条
  X 动态：changes 15 条
  GitHub 日报：✗ 未发布
  X 日报：✗ 未发布
缺口 2 项：
  - GitHub 日报 未发布（缺 event github-daily-2026-10-26）
  - X 日报 未发布（缺 event x-daily-2026-10-26）
```

（发布双日报后复跑即全绿——本 README 截取发布前的形态，正是工具在管道中间态的正确输出。）

历史回查（--date 2026-10-20）正确复现了 10-21 会话事故的形态：`x-likes/changes/2026-10-21.json 不存在` + `x-daily-2026-10-20 未发布`。

## 边界

- 「昨日无 X 动态 → 合法跳过日报」与「事故缺失」在本工具里都表现为缺口——它只报差异不做裁决，人工判断语义（或对照当天抓取日志）。
- changes 命名口径：`github-commits-fetch.ts <date>` 以参数日命名，其余三源以运行日命名；本工具已按各自实际口径核对。
