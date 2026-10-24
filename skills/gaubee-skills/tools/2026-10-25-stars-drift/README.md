# stars-drift — 星标兴趣漂移月览

## 是什么

catalog 是全量静态视图，没有时间维度。本工具读 `catalog.md` 的分类映射 + `stars.json` 的 `starred_at`，输出最近 N 天（默认 30）新星标按 taxonomy 分类的分布、与前一个同长窗口的对比、新星标主力语言。纯本地秒级，零网络零写入。

## 解决什么

回答「最近一个月我在关注什么、兴趣往哪漂」——日报只看昨天，周报只看 GitHub 提交，星标的时间聚合此前没有视图。首跑就给出了可解读的漂移信号。

## 怎么跑

```bash
bun tools/2026-10-25-stars-drift/stars-drift.ts            # 默认 30 天窗口
bun tools/2026-10-25-stars-drift/stars-drift.ts --days 7   # 周窗口
```

## 真实示例输出（2026-10-25 首跑，exit 0）

```text
窗口：最近 30 天 90 个新星标（前一个 30 天 54 个；星标全集 1711）

分类分布（本期 / 上期 / 增减）：
  AI Agent 与编码助手：34 / 13（+21）
  未分类：16 / 13（+3）
  AI/LLM 模型与应用：10 / 5（+5）
  前端框架与 UI 组件：7 / 4（+3）
  移动开发：6 / 3（+3）
  媒体、图形与创意编码：4 / 0（+4）
  Web 工程化与工具链：3 / 0（+3）
  …

新星标主力语言：Python 22、TypeScript 22、Rust 13、JavaScript 9、Swift 6
```

## 判读

最近 30 天星标节奏明显加快（90 vs 54），AI Agent 类从 13 涨到 34（+21，接近两倍）——与 10 月主线（CU 工程、agent 插件目录、AI 影视生产聚集）互证；语言面 Python 与 TypeScript 并列第一（agent 生态 Python 工具链占比高）。
