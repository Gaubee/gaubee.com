# deps-digest — 依赖变更人话化

## 是什么
对 github-deps 源，以 `changes/<date>.json` 的 changed[] 为准（与日报同源），
对比相邻两天的 history 快照（`repos[].deps[]`，以 section:name 为键），逐仓输出
「依赖从什么版本到什么版本 / 新增 / 移除」的一句话明细，供日报直接引用。

## 解决什么
changes 只给「N 个仓库依赖变更 + bumpedCount」，日报只能写「依赖变更 3」；
版本明细躺在没人读的 history 快照里。首跑（2026-10-14）即抓出一个数据语义发现：
changes 点名的 3 仓（bumpedCount 合计 10）在相邻快照对比下**均无版本级变化**——
bumpedCount 的统计口径比清单级变化宽（疑似 package.json 触碰即计数）。本工具
以快照真值为准、如实标注「仅清单元数据抖动」，日报从此可以诚实区分
「有版本升级」与「只有抖动」（R5：数据语义不伪装）。

## 怎么跑
```bash
bun tools/2026-10-14-deps-digest/deps-digest.ts [--date YYYY-MM-DD]
```
`--date` 缺省取 changes 目录最新一份；prev 取该 changes 的 prev_date。
退出码：0 = 正常输出；1 = 数据缺失（基线日/快照缺失，fail-closed）。

## 真实示例输出（2026-10-14 实跑）
```
BioforestChain/PlusMeta-Admin：快照对比无版本级变化（仅元数据/清单抖动）
BioforestChain/net-mesh-simulator：快照对比无版本级变化（仅元数据/清单抖动）
Gaubee/jSouper：快照对比无版本级变化（仅元数据/清单抖动）
```
有版本升级时的形态：`<repo>：vite 6.0.0→6.1.0；新增 @scope/pkg@^1.2.0`。
