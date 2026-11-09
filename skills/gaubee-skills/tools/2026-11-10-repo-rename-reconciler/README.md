# repo-rename-reconciler — 星标仓库改名对账（GitHub 301 探测）

## 是什么

扫最近 N 天星标 changes 里被「移除」的仓库，用 `gh api repos/<旧名>` 跟随 GitHub 的 301 重定向拿到新名字；配对后检查 `taxonomy.md` 是否还引用旧名，给出待更新清单。

## 解决什么

`github-stars-diff` 把仓库改名表现为「移除 1 + 新增 1」。另一种工具 `stars-integrity-audit` 靠「描述 + starred_at 完全相同」配对，能抓不改描述的改名；但**改名同时改描述**的会漏。2026-11-10 实证：`Pluviobyte/douyin-comments` 改名成 `saas-growth-agents`，描述从「抖音评论技能」扩成「SaaS 增长 agent 包」，靠描述匹配抓不到，只能人肉发现。GitHub 的 301 是权威答案，这个工具直接问它。

## 怎么跑

```bash
bun tools/2026-11-10-repo-rename-reconciler/repo-rename-reconciler.ts            # 最近 7 天
bun tools/2026-11-10-repo-rename-reconciler/repo-rename-reconciler.ts --days 14
bun tools/2026-11-10-repo-rename-reconciler/repo-rename-reconciler.ts --strict   # taxonomy 未更新退出 1
```

退出码：0 = 无待处理（`--strict` 且 taxonomy 未更新时 1）；2 = 数据缺失。只读，gh 只发 GET。

## 真实示例输出（2026-11-10）

```text
检查最近 7 天的 2 个移除项（gh 301 探测）
  Pluviobyte/douyin-comments → Pluviobyte/saas-growth-agents：taxonomy 已更新
  calesthio/OpenMontage → OpenMontageInc/OpenMontage：taxonomy 已更新
全部改名已在 taxonomy 对齐
```

两条都是当天/前一天刚处理过的改名；工具确认 301 目标与 taxonomy 一致。若 taxonomy 还引用旧名，会显示 `✗ taxonomy 仍引用旧名` 并在 `--strict` 下退出 1。

## 判读建议

- 查不到重定向的移除项，多半是真取消收藏或仓库被删，不需要改 taxonomy。
- 改名确认后，除了 taxonomy 行，还要顺手检查 `profile.md` / 日报里是否引用了旧名（工具只查 taxonomy，其余靠人）。
