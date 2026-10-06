# Design: json-viewer 应用

## 心智模型

```
输入（粘贴/拖文件/示例）                    工具栏（渐进披露：高级能力收纳于此）
    │                                          │
    ▼                                          ▼
┌─────────────────────┐   格式化/压缩/复制/清空/视图切换（树|原文）
│ CodeMirror (json)   │──────────────────────────────────────┐
│ 实时解析（防抖 250ms）│                                      │
└─────────┬───────────┘                                      ▼
          │                                            ┌───────────┐
    解析成功 ──────────────► JsonTree（递归折叠树，类型着色）│  树视图   │
          │                                            └───────────┘
    解析失败 ──────────────► 错误卡（行列 + 出错行摘录 + 消息）
          │
          ▼
    统计条（大小 / 顶层类型 / 节点数 / 最大深度）
```

## Phase 1 架构（ZCode 实现）

### 分层

```
src/lib/apps/views/json-viewer/
├── json-core.ts           纯逻辑：parseJsonWithPosition（错误行列定位）、
│                          buildStats（统计）、extractErrorLine（出错行摘录）
├── json-core.test.ts      server project 单测
└── JsonTreeNode.svelte    递归树节点（自引用组件）
src/lib/apps/views/
└── JsonViewerView.svelte  视图：布局 + 状态编排（不写 JSON 逻辑）
src/lib/apps/installable/
└── json-viewer.ts         manifest
```

- **纯逻辑与视图分离**：解析/错误定位/统计全部是纯函数（server project 可测），
  视图只做编排。遵循仓内「纯逻辑分层」惯例（参照 github/state/status.ts 范式）。
- **错误定位**：V8 `JSON.parse` 的 SyntaxError 消息含 `position N`（Firefox 是
  行列文本），纯函数 `parseJsonWithPosition` 把 position 换算成 `{line, column}`
  （按 `\n` 切分累加），并截取出错行前后文做摘录。跨引擎（Firefox 无 position）
  降级为无定位的原始消息，不硬失败。
- **树构建不落中间结构**：树视图直接消费 `parse` 成功后的 `unknown` 值递归渲染，
  不预构建整棵节点树（大 JSON 时省一次遍历与内存）；节点计数/深度等统计走
  `buildStats` 一次性遍历。
- **防抖**：输入 250ms 防抖后解析；空输入直接清空结果态。超长输入（>2MB）
  仍解析但树默认只展开第一层（性能兜底，展开交给用户）。

### 视图与交互

- 双视图 Tabs：`树` / `原文`。树视图为默认；解析失败时自动停留原文并展示错误卡
  （错误发生在原文视图，修复场景不应被切走）。
- 递归树节点：
  - 类型着色沿用 VS Code 语义直觉：string 绿 / number 蓝 / boolean 橙 /
    null 灰 / key 紫红（用站点 oklch 变量近似色，暗色模式自动适配——不写死
    hex，用 `oklch()` + CSS 变量）。
  - 对象/数组行：`键名` + 类型徽标 + 子项计数；点击切折叠。空对象/空数组
    直接内联展示 `{}` / `[]`，不可折叠。
  - 长字符串（>120 字符）截断 + 「…展开」，点击行内展开不折叠父级。
  - 折叠状态本地 `$state`；「全部展开/收起」经 context 下发版本号触发重算。
- 工具栏（从左到右）：格式化 / 压缩 / 复制 / 清空 / 示例 / 视图切换。
  每个按钮都有 tooltip（初级用户的引导层，高级用户的眼动捷径）。
- 空态：输入区 placeholder 引导（「粘贴 JSON，或点击右侧『示例』试试」）+
  结果区显示简短说明卡。
- 文件拖入：dragover 遮罩提示「松开导入 .json 文件」，drop 读文本进输入区。
- 样式自治：所有样式写在组件内（Tailwind + 组件级 CSS），不进 app.css；
  毛玻璃如需用必须按仓内标准搭配 contrast/brightness。

### 接线（三处）

1. `registry.ts`：import + register + export（category: default 走 installable 分组）。
2. `AppManager.svelte.ts`：`DEFAULT_APP_IDS` 加 `"json-viewer"`（默认安装可卸载）。
3. manifest：`/app/json-viewer` entry activity，`leafRoute` 懒加载视图。

## Phase 2 候选清单（Codex 实现）

按「高级工程师喜欢用、初级工程师无感」过滤后的候选（Codex 可增删，逐项走
小步提交 + 单测）：

| 候选                      | 价值                                       | 初级用户无感策略                           |
| ------------------------- | ------------------------------------------ | ------------------------------------------ |
| 路径查询（JSONPath 子集） | 大 JSON 里精确定位（$.a.b[0].c）           | 工具栏一个「查询」入口，placeholder 给例子 |
| JSON ↔ YAML 互转          | 配置文件双格式（js-yaml 已有依赖）         | 工具栏「转换」菜单，无配置项               |
| 生成 TypeScript 类型      | 前后端联调（从响应推 interface）           | 「转换」菜单内，结果一键复制               |
| JSON Schema 推断          | 接口文档/校验                              | 同上                                       |
| diff 对比模式             | 两份响应对比排查                           | 工具栏独立入口，默认不出现                 |
| 历史记录（最近 10 条）    | 重开应用找回刚才的数据（localStorage）     | 空态里显示「最近打开」，无设置             |
| 树虚拟滚动                | 大文件不卡                                 | 纯性能，无界面变化                         |
| 错误人话化                | 「缺少逗号」「多了一个逗号」等常见模式翻译 | 默认生效，自动增强                         |
| 快捷键                    | Cmd/Ctrl+Shift+F 格式化等                  | tooltip 里标注快捷键即可                   |
| CLI 命令（cliCommands）   | `json validate/format` 接入 Terminal PATH  | 纯 OS 集成，无界面变化                     |

## 全局约束（Phase 1/2 都必须遵守）

- **渐进披露是红线**：任何高级功能不得挤占默认界面；新入口必须有 tooltip；
  默认路径（粘贴 → 看树）永远是最短路径。
- 样式自治，禁止污染全局 app.css；滚动容器是 AreaOutlet 层
  （`.app-overlay-layer` / `.desktop-layer`），不是 window。
- 主题跟随站点 oklch 变量 + `.dark` 双模式；不写死 hex。
- 依赖零新增（js-yaml/zod/@codemirror/* 已在依赖里）；如必须新增需在 tasks.md
  记录理由与体积。
- 验证门禁：`pnpm build` exit 0（编译门禁，2026-10-05 裁决：禁止全量 svelte-check）；
  新增逻辑必须有单测（server project `*.test.ts`）。
- 提交信息中文 + 仓内 GIT_EMOJI 规范。
