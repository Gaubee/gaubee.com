# Tasks: add-json-viewer-app

## Phase 1：基础版（ZCode）

- [x] 1.1 纯逻辑 `json-core.ts`：parseJsonWithPosition（V8 position → 行列 +
      出错行摘录，Firefox 降级）、buildStats（大小/顶层类型/节点数/最大深度）、
      format/minify 工具 + `json-core.test.ts` 单测
- [x] 1.2 `JsonTreeNode.svelte`：递归折叠树（类型着色 / 子项计数 / 长字符串
      截断展开 / 空容器内联 / 全部展开收起）
- [x] 1.3 `JsonViewerView.svelte`：CodeMirror 输入 + 防抖解析 + 双视图 +
      工具栏（格式化/压缩/复制/清空/示例）+ 统计条 + 错误卡 + 空态 + 文件拖入
- [x] 1.4 manifest `installable/json-viewer.ts`（/app/json-viewer，default 类）+
      registry.ts + DEFAULT_APP_IDS 接线
- [x] 1.5 验证：新增单测全过 + `pnpm build` exit 0 + 浏览器走查（双端 +
      vision 子代理验收）
- [x] 1.6 走查修复轮（vision 两轮验收：首轮 4 fail → 修复 → 复核 8/8 ALL PASS）：
      P0 树键名逐字符竖排折行（.jv-key 改 flex-shrink:0 + overflow-wrap:anywhere）；
      P1 折叠箭头不旋转（根因：lucide 子组件根元素不带 scope hash，scoped 样式
      对 svg 全部失效——改 :global 后代选择器，实测 rotate 90° 生效）；
      P1 CodeMirror 无行号（组件新增 lineNumbers prop，默认关零回归）；
      P2 错误态统计条文案（「等待输入」→ 红色「无法解析」）；P2 72ch 写作限宽
      （组件新增 wide prop，默认关零回归）；P2 树缩进线加深（60%→90%）
- [x] 1.7 附带修复：AppManager 默认应用增量迁移（老用户一次性补装 json-viewer，
      打标不覆盖主动卸载；修复迁移时序 bug——writeStorage 提前调用会清空老用户
      已安装列表，被迁移单测当场捕获）+ AppManager.migrations.svelte.test.ts 4 用例

## Phase 2：高级功能（Codex）

> Codex 从此处接手。规则：逐项小步提交 + 单测；不得破坏渐进披露红线；
> 完成一项勾一项，并在「Codex 变更记录」追加一段说明（做了什么/为什么/怎么无感）。

- [x] 2.1 路径查询（JSONPath 子集：$ . [] * .. 递归），查询结果高亮 + 提取为
      新树；工具栏「查询」入口，placeholder 带示例
- [ ] 2.2 转换菜单：JSON ↔ YAML（js-yaml）、生成 TypeScript 类型、JSON Schema
      推断；结果进 Dialog 可复制
- [ ] 2.3 diff 对比模式（两份 JSON，键级 diff 视图）
- [ ] 2.4 历史记录：localStorage 最近 10 条（内容 + 时间 + 大小），空态展示
      「最近打开」可一键恢复；工具栏「历史」入口
- [x] 2.5 错误人话化：常见 SyntaxError 模式（缺逗号/多逗号/单引号/尾逗号/未闭合
      括号等）映射为中文提示 + 修复建议
- [ ] 2.6 大文件：树虚拟滚动（>5000 节点时启用），保证滚动 60fps
- [ ] 2.7 快捷键：格式化/压缩/复制/视图切换/清空（tooltip 标注）
- [ ] 2.8 CLI：cliCommands 声明 `json validate|format|minify`（stdin/文件参数，
      接入 Terminal PATH）
- [ ] 2.9 Codex 自由发挥（可选）：认为能显著提升高级工程师体验的其它能力，
      但每项必须附「初级用户无感」说明
- [ ] 2.10 Phase 2 验证：全部单测过 + `pnpm build` exit 0 + 浏览器双端走查

## Codex 变更记录

### 2.5 错误人话化（2026-10-06）

- 做了什么：为结构化 JSON 错误补充稳定的修复建议，覆盖尾逗号、缺逗号、单/中文引号、
  未闭合字符串/括号、冒号、转义、数字和多余根内容；错误卡同步展示「建议」。
- 为什么：把“解析失败”转换成下一步可执行的修复动作，减少来回试错。
- 初级用户为何无感：建议只出现在已有错误卡中，合法 JSON 的默认「粘贴 → 看树」路径
  没有新增按钮或设置。

### 2.1 路径查询（2026-10-06）

- 做了什么：新增 JSONPath 子集解析/求值（`$`、点属性、`[]`、`*`、`..`），查询 Dialog
  展示完整路径和结果预览，选中项在主树高亮，并可提取为新的树根。
- 为什么：高级工程师可以在大 JSON 中快速定位深层字段，避免手动展开大量节点。
- 初级用户为何无感：查询只占工具栏一个带示例 tooltip 的入口，默认粘贴和树视图不增加
  额外控件；关闭 Dialog 即回到原路径。
