# tech-adoption — 我什么时候开始用 X、它出现在哪些项目里

## 是什么

读站点公开的技能图谱投影，回答两类问题：
- **正查**：某个技术首见日期 + 用在哪些项目
- **反查**：某个项目的技术栈

## 解决什么

`tech-graph.md` 是本地全量视图，但 kzf 在浏览器里问「我什么时候开始用 Y」时没有入口。
本工具把 `timeline`（首见日）与 `edges`（项目→技术）在浏览器里对上，挂在 `/app/tools`。

## 怎么跑

```bash
bun tools/2026-11-24-tech-adoption/tech-adoption.ts           # 总览 + 最近首见
bun tools/2026-11-24-tech-adoption/tech-adoption.ts vite      # 正查
bun tools/2026-11-24-tech-adoption/tech-adoption.ts gaubee    # 反查
```

## 真实示例输出（2026-11-24）

```text
$ bun tools/2026-11-24-tech-adoption/tech-adoption.ts
技术采用索引：129 个项目 × 2834 个技术
时间线基线 2026-10-03（当时已有 679 项，这些不标「新采用」）；此后首见 25 项

最近首见的技术：
  2026-11-20  e2e
  2026-11-20  @jiudian/plugin-sdk

$ bun tools/2026-11-24-tech-adoption/tech-adoption.ts vite
【vite-plus】首见 （基线前已在用）
  用于：jixoai/skill-creator、Gaubee/pnpm-pub、Gaubee/ai-api-monitor、Gaubee/safe-npm-sdk
```

## 判读

- **「基线前已在用」不等于「没在用」**：2026-10-03 之前就在的技术记为首见基线，
  不是「新采用」——这是避免把存量伪装成新增。
- 公开投影只含公开仓；查私有仓（如 keel）请用本地 `tech-graph.md`，工具会提示这一点。
- 形态：**webapp**，数据 `static/skill-graph/data.json`，浏览器里可跑。
