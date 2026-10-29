# commits-digest — 日报提交素材一条命令

## 是什么

每天写 GitHub 日报都要手搓两三条 jq：各仓推送计数、公私标注、样本消息。本工具读 `history/<date>.json` 一次性输出日报写作素材：各仓分布（公/私标注）加私有仓每仓最长首条提交消息样本。

## 解决什么

日报「提交」节的固定工序工具化。注意边界：输出**含私有仓提交消息，只供本地写作参考**——写入日报前必须重写为工作流人话总结（R5 裁决），不得直发。

## 怎么跑

```bash
bun tools/2026-10-30-commits-digest/commits-digest.ts              # 默认昨天
bun tools/2026-10-30-commits-digest/commits-digest.ts 2026-10-28   # 指定日期
```

## 真实示例输出（2026-10-30 首跑，节选）

```text
# 2026-10-29 提交素材（公开 0 条 / 私有 85 条）

## 分布
- jixoai/fde2e（私有）：26 条
- jixoai/fde2e-omni-v1（私有）：23 条
- jixoai/fde2e-browser（私有）：16 条
…
## 私有仓样本（首条/最长条消息，本地素材勿直发）
```
