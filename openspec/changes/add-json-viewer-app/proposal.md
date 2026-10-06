# Change: 新增 json-viewer 应用（GaubeeOS osapp）

## Why

GaubeeOS 面向开发者场景的工具目前只有 Terminal 与 Github 系应用；JSON 是日常开发中
最常见的调试数据格式（API 响应、日志、配置），但站内没有一站式查看器。kzf 指令：
开发一个 osapp「jsonviewer」，先由 ZCode 完成基础版（Phase 1），再交由 Codex 补充
高级功能（Phase 2）。产品目标一句话：

> 高级工程师喜欢用的工具，同时初级工程师无学习成本上手。

实现策略是**渐进披露（progressive disclosure）**：默认界面只有「粘贴 → 看树」一条
路径，零配置零学习；所有高级能力收纳在工具栏/菜单中，带 tooltip 与占位引导，
初级用户可以完全无视它们而不受干扰。

## What Changes

### Phase 1（ZCode 实现，本 change 主体）

- 新增 osapp `json-viewer`（category: default，默认安装可卸载，main 区，
  路由 `/app/json-viewer`）。
- 核心能力：
  - 输入区：CodeMirror（json 语法高亮 + 行号），支持粘贴、拖入 `.json` 文件、
    加载内置示例（空态引导）。
  - 实时解析（防抖）：错误显示行/列 + 消息 + 出错行摘录；成功则进入树视图。
  - 树视图：递归折叠树，类型着色（string/number/boolean/null），对象/数组显示
    子项计数，长字符串截断可展开，全部展开/收起。
  - 工具栏：格式化（2 空格）、压缩、复制、清空；双视图切换（树 / 原文）。
  - 统计条：大小（B/KB）、顶层类型、节点总数、最大深度。
- 纯逻辑（解析/错误定位/统计/树构建）与视图分离，server project 可测；新增单测。

### Phase 2（Codex 实现，本 change 预留）

在 Phase 1 基础上补充高级工程师能力（详见 tasks.md Phase 2 与 design.md 候选清单）：
查询过滤（JSONPath 类）、格式互转（YAML/TS 类型/Schema 推断）、diff 对比、
历史记录、大文件虚拟滚动、错误人话化提示、CLI 命令接入 Terminal PATH 等。
Codex 可按判断增删候选项，但**不得破坏渐进披露原则**（见 spec 约束）。

## Impact

- 代码（新增）：`src/lib/apps/installable/json-viewer.ts`（manifest）、
  `src/lib/apps/views/JsonViewerView.svelte`（视图）、
  `src/lib/apps/views/json-viewer/`（树节点组件 + 纯逻辑模块 + 测试）。
- 代码（接线）：`src/lib/apps/registry.ts`、`src/lib/apps/AppManager.svelte.ts`
  （DEFAULT_APP_IDS）。
- Spec：`openspec/specs/json-viewer-app/spec.md`（本 change 携带，archive 时落位）。
- 无内容管道/搜索索引/Worker 变更；不新增运行时依赖（复用已有的
  @codemirror/lang-json、@lucide/svelte、shadcn-svelte 组件）。
