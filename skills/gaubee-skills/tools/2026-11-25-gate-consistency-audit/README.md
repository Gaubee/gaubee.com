# gate-consistency-audit — 两个提交门禁的口径交叉校验

## 是什么

把 `report-commit-count-audit` 与 `report-facts-check` 对同一份日报、同一个日期各跑一遍，比较两者的结论。不重算数字，只发现「一个说 ok、另一个说 fail」的口径冲突。

## 解决什么

2026-11-25 实证：同一份报告的同一批数字，两个门禁给出相反结论。

- `report-commit-count-audit` 按快照里的 `private` 字段求和 → 判「公开 12 + 私有 18」为 OK。
- `report-facts-check` 按仓库名正则 `fde2e|keel|jixoai/bu$|omni` 判私有 → 把已转公开的 `keel`、`reply9842` 算成私有，判「公开 6 + 私有 24」为错。

`gh repo view` 核对：`jixoai/fde2e` 是 PRIVATE，`keel` 与 `reply9842` 都是 PUBLIC。真正错的是后者的正则口径，已改为读 `private` 字段并复跑验证。本工具的作用是让这类「门禁互相打脸」在未来的某一天不再靠人发现——两个门禁只要有一方口径漂了，它就会报出来。

## 怎么跑

```bash
# 默认核对昨天
bun tools/2026-11-25-gate-consistency-audit/gate-consistency-audit.ts

# 指定日期
bun tools/2026-11-25-gate-consistency-audit/gate-consistency-audit.ts --date 2026-11-25

# 最近几天一起看
bun tools/2026-11-25-gate-consistency-audit/gate-consistency-audit.ts --all
```

退出码：0 = 两个门禁结论一致；1 = 出现口径冲突；2 = 目录缺失。只读，不改任何文件。

## 真实示例输出

修复 `report-facts-check` 之后，四天全绿：

```
OK   2026-11-22  report-commit-count-audit=ok  report-facts-check=ok
OK   2026-11-23  report-commit-count-audit=ok  report-facts-check=ok
OK   2026-11-24  report-commit-count-audit=ok  report-facts-check=ok
OK   2026-11-25  report-commit-count-audit=ok  report-facts-check=ok

GATE CONSISTENCY OK：两个门禁结论一致。
```

把 facts-check 的判定临时改回旧正则，工具立刻抓到冲突：

```
冲突 2026-11-25  report-commit-count-audit=ok  report-facts-check=fail
      提交公开数：报告写 12，facts-check 算 6
      提交私有数：报告写 18，facts-check 算 24

1 个日期口径冲突。
```

注意：冲突时不能直接信任一方的细项。数字本身是「公开 12 + 私有 18」，错的是 facts-check 的口径；但如果换一天，可能是相反方向。工具只负责指出矛盾，定性要看 `gh repo view` 与实际快照。
