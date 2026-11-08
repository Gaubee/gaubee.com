# stars-integrity-audit — 星标数据完整性审计

## 是什么

两件事一起查：
1. **改名识别**：最新 `changes` 里「移除一个、新增一个」，如果两者描述与 `starred_at` 完全相同、名字不同，基本就是仓库换了 owner（或改名）。工具会配对并检查 `taxonomy.md` 是否还引用旧名字。
2. **starred_at 静默修订**：把 `stars.json` 里每个仓库的 `starred_at`，与 changes 历史里最后一次「新增」记录的旧值对比。不一致说明上游数据被改写，历史日报里的累计总数会整体平移。

## 解决什么

2026-11-08/09 的实际问题：
- `calesthio/OpenMontage` 换成 `OpenMontageInc/OpenMontage`，diff 里是「移除 1 + 新增 1」，taxonomy 不会自动跟着改，靠人眼发现；
- `wquguru/cicada` 的 `starred_at` 从 11-03 被改成 11-08，`changes.changed[]` 不记录这个字段，`report-lint` 于是把 11-03～11-07 的历史日报判成「总数对不上」。有了这份审计，就能一眼区分「数据修订」和「算术错误」。

## 怎么跑

```bash
bun tools/2026-11-09-stars-integrity-audit/stars-integrity-audit.ts
bun tools/2026-11-09-stars-integrity-audit/stars-integrity-audit.ts --strict   # 有待处理项退出 1
bun tools/2026-11-09-stars-integrity-audit/stars-integrity-audit.ts --json
```

退出码：0 = 报告完成（`--strict` 且有「taxonomy 未更新」或「静默修订」时 1）；2 = 数据缺失。纯本地只读。

## 真实示例输出（2026-11-09）

```text
最新 changes：2026-11-09.json｜stars.json 1765 条
改名：1 对
  calesthio/OpenMontage → OpenMontageInc/OpenMontage（starred_at 2026-10-19）：taxonomy 已更新
starred_at 静默修订：1 条（历史累计会平移，report-lint 的漂移先看这里）
  wquguru/cicada：2026-11-03 → 2026-11-08（上次新增记录 2026-11-04）

说明：改名项要人工更新 taxonomy 与历史引用；静默修订是上游数据变化，不属算术错误。
```

## 判读建议

- 「taxonomy 仍引用旧名」要当天改掉（catalog 与检索都靠它）。
- 「静默修订」不用改历史日报：那是上游数据变化。`report-lint` 已经会按修订前的 `starred_at` 重算历史累计，不会再把这种漂移当算错。
