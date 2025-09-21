## 必读

- `TARGET.md` 是我们的开发目标。
- `AI_COLLABORATION_GUIDE.md` 是我们的协作方式。
- `TODO.md` 是我们的代办任务。

## 提交规范

1. git-commit-message 的提交规范的格式为：

   ```md
   $GIT_EMOJI $SCOPE $TITLE

   $DETAIL_LIST
   ```

   1. `GIT_EMOJI` 给一些常见的：
      - ✨ `:sparkles:`: **新功能**: 引入新功能。
      - 🐛 `:bug:`: **修复Bug**: 修复一个 Bug。
      - ♻️ `:recycle:`: **重构**: 对代码进行重构，既不修复错误也不添加功能。
      - 📖 `:book:`: **文档**: 添加或更新文档。
      - 📝 `:memo:`: **内容**: 添加或更新内容。
      - ⚡️ `:zap:`: **性能**: 提升性能。
      - ✅ `:white_check_mark:`: **测试**: 添加、更新或通过测试。
      - 💄 `:lipstick:`: **UI/样式**: 添加或更新 UI 和样式文件。
      - 🔥 `:fire:`: **移除**: 移除代码或文件。
      - 🚀 `:rocket:`: **部署**: 部署相关。
      - 🚧 `:construction:`: **进行中**: 工作正在进行中，通常用于功能分支的持续提交。
   2. `SCOPE` 是一个或多个单词，概况修改的目标，比如可以用 ui/layout/content/lib/i18n ，通常跟文件夹的名称一致
      > 如果一次提交涵盖多个SCOPE，那么可以省略SCOPE，在`DETAIL_LIST` 详细列出每一个scope的提交内容
   3. 使用中文提交

2. 提交之前需要使用 `pnpm fmt` 脚本来统一格式化要提交的问题
