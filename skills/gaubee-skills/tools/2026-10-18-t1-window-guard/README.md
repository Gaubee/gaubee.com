# t1-window-guard — T-1 归窗守卫

## 是什么
对「报告日 vs 差分运行日」做硬校验：报告日必须早于 run-date（把还没过完的一天
当报告日即 FAIL）；常规晨间 cron 下报告日应恰为 run-date 的昨天（确需偏移用
--allow-shift）；--scan 可批量体检 reports/daily 全部 frontmatter date。

## 解决什么
2026-10-18（周日）实证：cron 把周日误当周一，--date 2026-10-18（今天）生成了
X 日报，过去 24h 差分被整体错归一天，GitHub 日报日期同样写错。T-1 的硬规则
（报告日 < 差分运行日）此前只存在于 runbook 文字里，没有可执行的守卫。

## 怎么跑
```bash
bun tools/2026-10-18-t1-window-guard/t1-window-guard.ts --date 2026-10-17                # 常规
bun tools/2026-10-18-t1-window-guard/t1-window-guard.ts --date 2026-10-18                # 事故场景 → FAIL
bun tools/2026-10-18-t1-window-guard/t1-window-guard.ts --scan                           # 全量体检
```
建议位置：x-daily-events 生成之前。退出码：0 通过；1 违反 T-1；2 用法异常。

## 真实示例输出（2026-10-18 实跑）
```
T1 OK：报告日 2026-10-17（run-date 2026-10-18）归窗正确            （exit 0）
FAIL 报告日 2026-10-18 晚于（或等于）差分运行日 2026-10-18——把还没过完的一天当成了报告 （exit 1）
SCAN OK：reports/daily 无晚于今天 2026-10-18 的报告
```
