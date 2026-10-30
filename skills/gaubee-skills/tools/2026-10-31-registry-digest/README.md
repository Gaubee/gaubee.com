# registry-digest — 工坊待裁决清单汇总卡

## 是什么

REGISTRY 的 proposed 行随工坊日积月累，本工具把待裁决条目按日期汇总成一张裁决卡：每行「工具 + 一句话 + 首跑发现 + 空白栏」，kzf 在栏里写「留 / 弃 / 改 + 一句理由」即可完成批量裁决；`--md` 把卡片落成文件。只读，零写入（--md 只写卡片文件）。

## 解决什么

首跑揭了个底：**REGISTRY 自 2026-10-03 工坊开办以来 53 个提案全部停留在 proposed，0 个被裁决**——不是工具不好用，是「裁决」这个环节一直没有低摩擦的入口。本工具把入口降到「在一行后面写两个字」。

## 怎么跑

```bash
bun tools/2026-10-31-registry-digest/registry-digest.ts --md /tmp/registry-card.md
```

## 真实示例输出（2026-10-31 首跑，节选）

```text
# 工坊待裁决卡（2026-10-31）

proposed 53 个｜已裁决 0 个。每行末尾写「留 / 弃 / 改 + 一句理由」即可完成批量裁决。

- [ ] **pipeline-env-doctor**（tools/2026-10-09-pipeline-env-doctor/）：… → ______
- [ ] **x-session-probe**（tools/2026-10-22-x-session-probe/）：… → ______
…
```

## 边界

- 只汇总不裁决——裁决结果仍由学习闭环回写 REGISTRY 状态与 feedback-log。
- 一句话取 REGISTRY 原文，管道符已转义为分号。
