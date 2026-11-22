# weekly-theme-signals — 周报分析动笔前的「主题信号」清单

## 是什么

周报的「分析」段要写主题聚类、与 profile 的印证/漂移、工具与裁决进展。
`weekly-digest` 给的是按仓库的提交清单，人还得自己归纳主线。本工具把归纳所需的四类信号抽出来：

1. **提交主线**：按 conventional scope（`feat(jiudian)` / `fix(triggers)` …）聚合，看出哪条线最重
2. **星标主题**：本周新增按策展分类聚合，看兴趣往哪偏
3. **抖动识别**：改名对数与元数据变化占比，提醒这些不是新信号
4. **工坊进展**：本周 REGISTRY 新增了哪些提案、全簿状态分布

## 解决什么

2026-11-23 写 W47 周报时，117 条提交分散在 6 个仓库、28 个日期文件里。
靠人读要靠记忆拼主线。本工具首跑直接给出：

- `fix(jiudian)` 9 条、`test(e2e)` 9 条、`docs(jiudian)` 8 条、`feat(jiudian)` 7 条——久点是绝对主线
- 星标 21 个新增里 `AI Agent 与编码助手` 占 6 个，其余分散在 8 个分类——兴趣明确偏 agent skills
- 改名若干对 + 元数据变化 56 项——要提醒读者别当新信号
- 本周新增提案 14 个，全簿 approved 65 / proposed 26

这些数字直接支撑了周报分析段的每一个论断，不用再凭印象。

## 怎么跑

```bash
bun tools/2026-11-23-weekly-theme-signals/weekly-theme-signals.ts --from 2026-11-16 --to 2026-11-22
```

退出码：0 = 已输出；2 = 参数/数据缺失。只读，不写报告。

## 真实示例输出（2026-11-23，W47）

```text
[提交主线] 共 117 条，按 scope 聚合（前 8）：
  fix(jiudian)：9 条（fde2e）
  test(e2e)：9 条（fde2e）
  docs(jiudian)：8 条（fde2e）
  feat(jiudian)：7 条（fde2e）

[星标主题] 本周新增 21 个，按策展分类：
  AI Agent 与编码助手 6：kangarooking/cangjie-skill、Illyism/seo-skills、…
  移动开发 2：tiann/KernelSU、imxieyi/Kernarium
  网络、P2P 与分布式 2：bluenviron/mediamtx、AlexxIT/go2rtc

[抖动识别] 改名 3 对，元数据变化 56 项（这些不是新信号）

[工坊进展] 本周新增提案 14 个：…
  全簿状态：approved 65 / proposed 26
```

## 判读建议

- 「其它」组（无 conventional 前缀的提交，多为站点自动发布）通常不必细写，一句话带过。
- scope 聚合能看出「哪条线最重」，但要判断「它们是不是同一件事」仍需人读消息——工具只数数量。
- proposed 26 说明裁决积压：建议在周报分析里点出来，或在给 kzf 的汇报中单独列。
