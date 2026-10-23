# trans-quality-sampler — X 译文质量抽查器

## 是什么

从 `translations/x-tweets.zh.json`（3120 条）随机抽样 n 条，输出原文/译文对照的 markdown 报告，附机械特征统计：URL 保留率、emoji 保留率、机械红旗（URL 减少 / **t.co 残留** / emoji 减少 / 疑似漏翻 / 空译文）。`--seed` 可复现，`--md` 落报告文件。零网络、秒级退出、不写数据。

## 解决什么

翻译管道只有覆盖门禁（translations-doctor 查「翻没翻」）没有质量闭环——「翻得好不好」全靠人工翻库。本工具把抽检成本降到一条命令；首跑就抓到真实问题：**部分历史译文尾部残留原文没有的 `t.co` 短链**（早期合并管道把展开失败的短链带进了译文）。

## 怎么跑

```bash
bun tools/2026-10-24-trans-quality-sampler/trans-quality-sampler.ts                    # 默认 n=12 seed=42
bun tools/2026-10-24-trans-quality-sampler/trans-quality-sampler.ts --n 8 --seed 7 --md /tmp/trans-sample.md
```

## 真实示例输出（2026-10-24，n=8 seed=7，exit 0）

```text
汇总：URL 保留 8/8｜emoji 保留 8/8｜红旗 2（1869498650663202997,1996842431623668159）
```

报告节选：

```markdown
## 1869498650663202997（长比 1.00；⚠ t.co 残留（原文无此链））
- 原：The biggest change in React 19? refs. Here's why 👀
- 译：React 19 最大的变化？refs。原因如下 👀 https://t.co/WGIh9tw8cM
```

## 判读与边界

- 「疑似漏翻」只对**非中文原文**且译文=原文触发——中文原文照抄进译文库是管道的正常行为，不误报。
- 抽样是人工抽检的放大器，不是自动裁决；红旗条目建议人工过目后走 `--ids` 重翻富化。
- 首跑 8 条抓到 2 条 t.co 残留——若多次抽样持续命中同类，值得写一次性清洗脚本全库扫描 t.co 残留。
