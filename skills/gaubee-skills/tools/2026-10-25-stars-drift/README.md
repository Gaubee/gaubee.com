# stars-drift — 星标兴趣漂移月览

## 是什么

catalog 是全量静态视图，没有时间维度。本工具读 `catalog.md` 的分类映射 + `stars.json` 的 `starred_at`，输出最近 N 天（默认 30）新星标按 taxonomy 分类的分布、与前一个同长窗口的对比、新星标主力语言。纯本地秒级，零网络零写入。

2026-11-25 升级：加**主题双窗口漂移**（仓库自打的 topics，比策展分类细）与**语言双窗口对比**，并补 `--json`；同时接入 `/app/tools` 网页入口。

## 解决什么

回答「最近一个月我在关注什么、兴趣往哪漂」——日报只看昨天，周报只看 GitHub 提交，星标的时间聚合此前没有视图。首跑就给出了可解读的漂移信号。

## 怎么跑

```bash
bun tools/2026-10-25-stars-drift/stars-drift.ts            # 默认 30 天窗口
bun tools/2026-10-25-stars-drift/stars-drift.ts --days 7   # 周窗口
bun tools/2026-10-25-stars-drift/stars-drift.ts --json     # 管道输出（分类/主题/语言）
```

## 真实示例输出（2026-11-25，exit 0）

```text
窗口：最近 30 天 113 个新星标（前一个 30 天 88 个；星标全集 1825）

分类分布（本期 / 上期 / 增减）：
  AI Agent 与编码助手：34 / 37（-3）
  未分类：31 / 14（+17）
  AI/LLM 模型与应用：11 / 9（+2）
  Rust / WASM / 系统编程：8 / 1（+7）
  前端框架与 UI 组件：8 / 8（0）
  自托管、桌面与效率软件：5 / 3（+2）
  移动开发：4 / 6（-2）
  网络、P2P 与分布式：3 / 0（+3）

主题漂移（本期 / 上期，按增量取前 12）：
  golang：10 / 1（+9）
  streaming：6 / 0（+6）
  rust：12 / 7（+5）
  linux：7 / 3（+4）
  docker：6 / 2（+4）
  go：6 / 2（+4）
  windows：5 / 1（+4）
  pixel-art：4 / 0（+4）
  mcp：10 / 7（+3）
  image-processing：3 / 0（+3）

语言（本期 / 上期）：Rust 23/13、TypeScript 20/23、Python 19/21、Go 18/3、JavaScript 14/9、C++ 5/2
```

## 判读

- 30 天节奏还在加快（113 vs 88），但 AI Agent 分类微降（34 / 37），增量去了 Rust 系统编程（8 / 1）与未分类长尾（31 / 14）。
- 主题面 Go 从 1 涨到 10、docker 从 2 涨到 6、image-processing 从 0 涨到 3；语言面 Go 从 3 涨到 18。和当天新收的四个图像处理项目（imgproxy / imgforge / viprs / Pixels）方向一致。
- 分类计数来自 catalog（策展），主题计数来自仓库 topics（约 65% 仓库有标签）；两者口径不同，不要互相校验。

