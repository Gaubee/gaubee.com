# trans-tco-scrub — 译文 t.co 残留全库扫描与清洗

## 是什么

trans-quality-sampler（10-24）首跑在 n=8 抽样里抓到 t.co 残留并预言「值得全库扫描」——本工具就是那个全库版：扫描「译文含 t.co 且原文不含同一链接」的条目，`--fix` 剥离译文里的多余短链（原文本来就有的不动），写回 `translations/x-tweets.zh.json`。

## 真实规模（2026-10-28 首跑，dry）

```text
残留 1222 条（共 1610 个多余 t.co）：
  2105394754150158619：https://t.co/RZ50rNBin2 https://t.co/EAtNkaUDpg
  2105034378837709099：https://t.co/lPOvUCOLtT
  …
```

**占译文库（3138 条）近四成**，远超抽样预估——残留是历史管道的系统性产物，不是零星个案。

## 为什么 dry 后停在裁决

`--fix` 本身是安全的（只删译文里多余短链），但译文变了就必须重渲染受影响日期的日报与归档（`--force` + 逐日考古 run-date），1222 条散布在大量历史日期上，批量重渲染是管道级动作。**是否清洗、清洗后怎么重渲染，留给 kzf 裁决**，工具先以 dry 形态交付。

## 怎么跑

```bash
bun tools/2026-10-28-trans-tco-scrub/trans-tco-scrub.ts          # dry：列出规模
bun tools/2026-10-28-trans-tco-scrub/trans-tco-scrub.ts --fix    # 清洗（裁决后）
```

## 建议的执行路径（裁决后）

1. `--fix` 清洗译文库；
2. 重渲染不必逐日考古全量——历史卡片里 t.co 本来就是不可点击的死链，页面显示层建议优先对**近期高频访问日期**（归档页）做 `x-archive-events` 全量重写，其余日期随日常管道逐步消化。
