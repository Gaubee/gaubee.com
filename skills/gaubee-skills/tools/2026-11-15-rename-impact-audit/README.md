# rename-impact-audit — 星标仓库改名后「已发布内容还引用旧名」的清单

## 是什么

从星标 changes 历史里认出名（描述与 starred_at 相同、仓库全名不同），然后扫三类文件，按文件列出旧名残留：

| 类别 | 位置 | 处置 |
| --- | --- | --- |
| taxonomy | `data/taxonomy.md` | **必改**，否则检索指旧名 |
| 历史报告 | `reports/{daily,weekly,monthly,yearly}` | 建议改，链接靠 GitHub 301 能跳但名字与现状不符 |
| 已发布 event | `src/content/events/` | 编号冻结，只能另发勘误，不改历史文件 |

## 解决什么

`stars-integrity-audit` 只报「taxonomy 是否还引用旧名」，改完 taxonomy 就结束了。但旧名实际还留在历史日报和周月报里——2026-11-15 首跑给出 19 对改名、35 个文件残留。

首跑还直接抓到两个 taxonomy 的真问题：
- `aimod-cc/agent2api` 写成小写，GitHub 实际是 `aimod-cc/Agent2API`（大小写敏感，链接会 301）；
- `facebook/lexical` 已迁到 `meta/lexical`，taxonomy 的「代表」行还写着旧 owner。

两条都在当天修掉。

## 两条容易被误判的规则

1. **描述为空不配对**。空描述会让任意两个仓库都「相同」，是误报的主要来源。
2. **目标名必须仍在当前收藏里**。否则那是「删了一个、另加一个」，不是改名。
   反例：11-12 的 `electric-sql/electric → neondatabase/electric` 在 11-15 又被删了，
   不加这条会产出方向可疑的配对。
3. **匹配按边界**。`electric-sql/electric` 不能把 `electric-sql/electric-pglite` 算命中，
   否则每次都会多出一批假残留（首跑实际发生过）。

## 怎么跑

```bash
bun tools/2026-11-15-rename-impact-audit/rename-impact-audit.ts
bun tools/2026-11-15-rename-impact-audit/rename-impact-audit.ts --since 2026-11-01
bun tools/2026-11-15-rename-impact-audit/rename-impact-audit.ts --json
```

退出码：0 = 列出完成（有无残留都 0，它是清单工具不是门禁）；2 = 目录缺失。纯本地只读。

## 真实示例输出（2026-11-15 首跑，修 bug 后）

```text
改名影响面：19 对

aimod-cc/agent2api → aimod-cc/Agent2API（starred_at 2026-10-10，2026-10-17 认名）
  ✗ taxonomy 仍引用旧名（1 处，应改）
  · 历史报告 reports/daily/2026-10-10.md（2 处，可改写）
  · 已发布 event 01826.signals-weekly-W41.md（2 处，编号冻结，只能另发勘误）

codepawl/67.js → codepawl/crucible（starred_at 2026-11-09，2026-11-15 认名）
  · 历史报告 reports/daily/2026-11-09.md（2 处，可改写）
  · 已发布 event 01900.github-daily-2026-11-09.md（2 处，编号冻结，只能另发勘误）
```

修完 taxonomy 后重跑，`taxonomy 仍引用旧名` 归零，只剩历史报告与已发布 event 的提示。

## 判读建议

- 「已发布 event」不是错误，是既有事实：编号文件不可变，要更正只能另发勘误 event。工具列出来是让人知道影响面，不是要求改历史。
- 历史报告可改也可以不改：链接能靠 301 跳，但正文名字与仓库现状不符，读者会困惑。建议改。
- 这类残留会随改名持续累积，所以它是「每次看到改名就跑一次」的工具，而不是每日门禁。
