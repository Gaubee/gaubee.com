# deps-jitter-probe — deps changes 日噪根因解剖

## 是什么
对被 changes 反复点名的仓库，取 GitHub API 的主分支 package.json（gh api 认证），
解析依赖表与本地最新 history 快照逐项对比，输出判定：
- 内容一致 = true → 仓库没变，是 fetcher 侧把重抓记成了变更（工具侧缺陷，B）；
- = false → 仓库 package.json 确有非依赖级每日改动（仓库侧行为，A）。

## 解决什么
jitter-report 实证三仓连续 8 天被 changed 点名且零快照级变化，但无法区分「仓库真
在变」与「fetcher 误报」。首跑（2026-10-17）判定 **B 成立**：PlusMeta-Admin
（38 项）/ net-mesh-simulator（47 项）/ jSouper（13 项）的远端依赖表与本地快照
完全一致——仓库 package.json 没有每日改动，changed[] 是 fetcher 运行内态产出的
误报。为后续对 github-deps-fetch.ts 的定点修复提供了直接证据（修复时需排查其
重抓选择逻辑为何每日选中 pushed_at 早在 2016 的 jSouper）。

## 怎么跑
```bash
bun tools/2026-10-17-deps-jitter-probe/deps-jitter-probe.ts [--repos a,b,c]
```
经本机 gh api 认证调用。退出码：0 = 正常输出。

## 真实示例输出（2026-10-17 实跑）
```
对照快照：history/2026-10-17.json

BioforestChain/PlusMeta-Admin
  快照依赖 38 项 / 远端 package.json 依赖 38 项 / 内容一致=true

BioforestChain/net-mesh-simulator
  快照依赖 47 项 / 远端 package.json 依赖 47 项 / 内容一致=true

Gaubee/jSouper
  快照依赖 13 项 / 远端 package.json 依赖 13 项 / 内容一致=true

判定：内容一致=true → fetcher 侧把重抓记成了变更（B）；...
```
