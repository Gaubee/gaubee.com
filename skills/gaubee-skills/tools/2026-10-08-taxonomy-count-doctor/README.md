# taxonomy-count-doctor

## 是什么

taxonomy.md 各分类标题的括号数字（如 `### AI Agent 与编码助手（154）`）靠 agent 手写，
与 `github-stars-categorize.ts --stats` 的脚本权威计数会发生漂移。本工具把「数字是否
与脚本一致」变成一条命令的体检。

## 解决什么

2026-10-08 每日维护实测：taxonomy 标签漂移两处（标 153 实 154、标 96 实 95）靠人工
发现；本工具首跑又抓出两处历史漂移（AI/LLM 标 121 实 124、移动开发标 68 实 70）。
分类括号数字是 `--suggest`/日报等环节的展示口径，漂移即口径失真。

## 怎么跑

```sh
bun ~/.agents/skills/gaubee-skills/tools/2026-10-08-taxonomy-count-doctor/taxonomy-count-doctor.ts          # 体检
bun ~/.agents/skills/gaubee-skills/tools/2026-10-08-taxonomy-count-doctor/taxonomy-count-doctor.ts --fix    # 修正（先备份 .bak）
```

路径覆盖：`TAXONOMY_FILE`（默认 `~/.gaubee-skills/data/taxonomy.md`）、`SKILL_DIR`
（默认 `~/.agents/skills/gaubee-skills`）。

## 真实示例输出（2026-10-08 实跑）

体检（--fix 前，抓出 2 处历史漂移）：

```
taxonomy-count-doctor：/Users/kzf/.gaubee-skills/data/taxonomy.md
分类标题 20 个，脚本计数 20 个

漂移（标称 → 实数）：
  AI/LLM 模型与应用：121 → 124（差 +3）
  移动开发：68 → 70（差 +2）

2 处漂移。加 --fix 以脚本为准改写标签（先备份 .bak）。
```

--fix 后复跑：

```
分类标题 20 个，脚本计数 20 个

OK：全部括号计数与脚本权威值一致
```

退出码：全对齐 0；有漂移 1（可直接当 CI/管道门禁用）；用法错误 2。
