## Project Configuration

- **Language**: TypeScript
- **Package Manager**: pnpm
- **Add-ons**: tailwindcss, vitest, playwright, mdsvex, sveltekit-adapter

---

## 必读

- [`TARGET.md`](./TARGET.md) 是我们的目标指南。
- [`TODO.md`](./TODO.md) 是我们的代办任务。

## AI 协作指南

本文件旨在记录与 AI 助手（Jules）协作时的工作流程和偏好，以确保沟通顺畅、高效。

> _本指南会根据我们的合作进展随时更新。_

1. 沟通与规划
   - **中文沟通**: 我们之间的所有沟通都将使用中文。
   - **明确计划**: 在开始任何实质性的编码工作之前，AI 需要提供一份清晰、分步的执行计划。计划需要获得我的批准后才能开始执行。
   - **任务追踪**: 使用根目录下的 `TODO.md` 文件来追踪项目的宏观任务和未来规划。
2. 开发技术栈：
   1. react
   1. vite
   1. vitest
   1. tailwindcss v4
   1. shadcn/ui
   1. magic/ui
   1. astro v4
   1. lucide-react
3. 开发流程
   - **Commit Message 规范**: 所有的 Git 提交信息（Commit Message）都必须使用中文书写，清晰地描述本次提交的内容。
   - **提交前检查**: 在执行 `submit` 操作之前，必须完成以下检查：
     1. **运行类型检查**: 执行 `pnpm ts` 来确保没有 TypeScript 类型错误。
     2. **运行测试**: 如果项目中有自动化测试，必须全部运行并通过。
     3. **代码审查**: 调用 `request_code_review()` 工具来获取代码变更的反馈。
   - **前端验证**: 如果进行了任何前端 UI 相关的更改，必须在提交前执行 `frontend_verification_instructions` 并遵循其指示完成验证。
   - **测试环境**: 我们的开发环境中已经安装了 `npm:playwright`、`npm:vitest` 的相关依赖了。方便 AI 使用 vitest/playwright 来编写测试代码。
     1. 使用 `pnpm test` 来执行 playwright 测试脚本。
        1. 使用之前请仔细阅读 `playwright.config.ts` 文件。
           > 比如你可以通过环境变量`PLAYWRIGHT_BASE_URL`来自定义`page.goto('/')`的baseUrl
        2. 或者自己执行 `pnpm playwright` 去做更加仔细更加可控的的测试运行
     2. 使用 `pnpm vitest --run` 来执行 vitest 测试脚本
   - **单元测试**: 在`tests`文件夹下开发 vitest 测试代码来验证基础功能。也可以开发 Playwright 脚本，用来做组件可用性可靠性验证。
     > 为此可能需要提供一些特殊的页面来为组件的测试提供访问路径。可以使用 `/_test/*` 这样的路径
   - **技术验证**: 在`tests/jules-scratch`文件夹下，使用 Playwright 脚本 + 截图的方式进行验证。这套流程（启动服务 -> 编写/运行脚本 -> 生成截图 -> 分析截图 -> 修复 -> 再次验证）被证明是定位和解决布局等视觉问题的有效方法。
4. 分支与提交
   - **分支命名**: 功能开发分支应使用 `feat/` 前缀，例如 `feat/redesign-ui`。修复 bug 的分支应使用 `fix/` 前缀。
   - **提交**: 当所有工作完成并通过检查后，使用 `submit` 工具提交代码。

## 快速开始

- 使用 `pnpm dev` 可以启动http服务
- 使用 `pnpm ts` 来获取ts类型检查，使用`pnpm ts --watch`可以实时监控

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

2. 提交之前要更新 `TODO.md`，来将完成的任务补充进去。
3. 提交之前需要使用 `pnpm fmt` 脚本来统一格式化要提交的问题。

## 内容阅读与搜索架构（2026-07-21）

### 决策

- 文章与短评应用各自在 manifest 声明 `searchService` 工厂；搜索应用不得导入具体内容应用。
- 静态索引按应用、发布时间倒序和约 500 KiB 分片生成；浏览器只加载命中应用的分片。
- 移动导航必须从 `AppManager` 的已安装应用投影，不能回退到静态 `nav-items`。

```
src/content/{articles,events}
          │ build
          ▼
 static/search-index/{manifest,shards}
          │ lazy fetch
          ▼
AppManifest.searchService ──► Search registry ──► SearchView
          │                                      (Lucene + progressive batches)
          └── AppManager install / uninstall
```

### 阅读契约

- Markdown 目录与正文共用 `marked-gfm-heading-id` 结果；不得自行生成 slug。
- 目录、年份入口和长短内容展开均须提供桌面与移动的可访问交互。
- 宽桌面右侧目录由拉伸的 grid 侧栏承载：外层 `nav` 负责 `sticky top-8`，内层目录负责限高滚动；不得给侧栏使用 `self-start`，也不得将 sticky 放在内部滚动盒上。
- 对内容的搜索结果按日期优先显示；首个非空批次立即渲染，后续结果以窗口合并降低列表抖动。

### 验证入口

- `pnpm content:prepare` 生成只读 VFS 与搜索索引。
- `pnpm build` 是静态产物事实来源；SSG E2E 应在 production preview 中运行。
- `PLAYWRIGHT_BASE_URL` 用于复用已有服务器；未设置时 Playwright 自行运行 `pnpm build && pnpm preview`。
