# json-viewer-app Specification

## Purpose

GaubeeOS 的 JSON 查看器 osapp：粘贴/导入 JSON 即得可浏览的树视图；面向高级工程师
提供专业能力，面向初级工程师保持零学习成本（渐进披露）。

## Requirements

### R1 输入（零门槛）

- 应用提供输入区（CodeMirror，json 语法高亮 + 行号），支持直接粘贴。
- 支持拖入 `.json` 文件导入（dragover 有遮罩提示，drop 读入输入区）。
- 空态提供「示例」按钮一键填充示例数据；输入区 placeholder 引导
  （「粘贴 JSON，或点击『示例』试试」）。
- 提供清空能力，清空后回到空态。

### R2 解析与错误（友好优先）

- 输入变更后防抖（≤300ms）实时解析，不要求用户点击「解析」按钮。
- 解析失败显示：行/列定位 + 出错行摘录 + 原始错误消息；引擎不提供位置信息时
  降级为仅消息，不硬失败。错误展示不得注入执行摘录文本（XSS 安全）。
- 解析成功隐藏错误，进入结果视图。

### R3 树视图（默认视图）

- 递归折叠树：对象/数组可折叠展开并显示子项计数；空对象/空数组内联 `{}`/`[]`。
- 值类型着色（string/number/boolean/null），跟随站点明暗主题。
- 长字符串截断展示，可点击展开完整内容。
- 提供全部展开 / 全部收起。
- 超长输入（>2MB）默认只展开第一层（性能兜底）。

### R4 工具与统计

- 工具栏提供：格式化（2 空格缩进）、压缩、复制结果、视图切换（树/原文）。
  每个按钮必须有 tooltip。
- 统计条展示：字节大小（B/KB/MB 自适应）、顶层类型、节点总数、最大深度。
- 原文视图保留输入原文（CodeMirror），带语法高亮。

### R5 OS 集成

- manifest：id `json-viewer`，category `default`（默认安装可卸载），
  main 区，路由 `/app/json-viewer`，视图懒加载（leafRoute 动态 import）。
- 注册接线：registry.ts（register + export）+ AppManager DEFAULT_APP_IDS。

### R6 渐进披露（红线，约束 Phase 2 全部演进）

- 默认界面只呈现 R1-R4 的最小路径（粘贴 → 看树）；任何后续高级能力
  （查询/转换/diff/历史等）必须收纳进工具栏入口且带 tooltip，
  不得增加默认视图的理解成本。
- 新增界面能力必须有快捷方式可绕过（键盘/按钮），不允许仅拖拽/隐藏手势可达。

### R7 质量约束

- 纯逻辑（解析/错误定位/统计）与视图分离，纯逻辑有 server project 单测。
- 样式自治（组件内 Tailwind/CSS），不修改全局 app.css；滚动容器为 AreaOutlet 层。
- 编译门禁：`pnpm build` exit 0；禁止以全量 svelte-check 为门禁。
