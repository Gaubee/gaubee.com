# rename-similarity-audit — 用相似度认出「描述也改了的改名」

## 是什么

`rename-impact-audit` 只认「描述与 starred_at 完全相同」的改名。改动描述或描述为空的改名会被漏掉。
本工具对同日 `removed × added` 的每一对打分，把可能是改名的配对挑出来给人确认：

| 信号 | 权重 |
| --- | --- |
| `starred_at` 完全相同 | 3 |
| owner 相同 | 2 |
| 仓库名相近（子序列/长前缀） | 最多 2 |
| 描述 token 重叠 ≥ 35% | 2 |

总分 ≥ 6 判「高置信」，≥ 4 判「疑似」。

## 解决什么

2026-11-20 那天 9 条新增里其实有 3 条是改名，老工具只抓到 1 条：

- `electric-sql/electric-pglite → pglite`（描述相同，抓到）
- `pgrundev/pgx → pgboxdb`（描述重写，漏）
- `webrtc-sdk/webrtc → livekit/libwebrtc`（描述为空，漏）

本工具首跑把三条全抓到：前两条「高置信 9 分」，第三条「疑似 5 分」（owner 变了，只有 starred_at 与名字作证）。
另外两条漏掉的原因不是判断难，是判据太窄——重写描述恰恰是改名时常做的事。

## 怎么跑

```bash
bun tools/2026-11-20-rename-similarity-audit/rename-similarity-audit.ts
bun tools/2026-11-20-rename-similarity-audit/rename-similarity-audit.ts --date 2026-11-20
```

退出码：0 = 已输出；2 = 数据缺失。只读，不改 taxonomy（改名是否成立要人判断）。

## 真实示例输出（2026-11-20）

```text
2026-11-20：removed 3 × added 9，改名候选 3 个
  [高置信 9] pgrundev/pgx → pgrundev/pgboxdb
      starred_at 相同；owner 相同；名字相近 100%；描述重叠 92%
  [高置信 9] electric-sql/electric-pglite → electric-sql/pglite
      starred_at 相同；owner 相同；名字相近 100%；描述重叠 100%
  [疑似 5] webrtc-sdk/webrtc → livekit/libwebrtc
      starred_at 相同；名字相近 100%
```

## 判读建议

- 「高置信」多半是真改名，但要留意同一作者一天内同时新建同名系列仓的情况（那时会被误判）。
- 「疑似」的典型形态是换了 owner（个人仓转组织仓），只有 `starred_at` 与名字能作证。
- 确认后按老规矩处理：taxonomy 换名、注释里可以写历史名、历史报告可改、已发布 event 编号不动。
