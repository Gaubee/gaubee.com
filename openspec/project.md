# Project: gaubee.com

kzf（Gaubee）的个人站点与「gaubeeOS」应用系统。SvelteKit（kit 2.x 钉版）+ adapter-static，
Rust static-server 容器部署，CI 构建镜像推 GHCR。

## 技术约束（摘要）

- pnpm workspace：root（站点）+ worker；pnpm10（CI/Docker，读 `onlyBuiltDependencies`）与
  pnpm12（本地，读 `allowBuilds`）双版本共存，两段配置都在 pnpm-workspace.yaml。
- 依赖版本一律精确钉死（`latest` 禁止——kit 3 灾难教训，2026-10-05）。
- tsconfig extends `./.svelte-kit/tsconfig.json`（kit2 约定；`$app/tsconfig` 是 kit3 专属）。
- gaubeeOS 应用：AppEntry manifest（activities/widgets/contentPipeline/vfsOwnership），
  路由 leafRoute，滚动容器是 AreaOutlet 的 `.desktop-layer` / `.app-overlay-layer` /
  `.deep-link-layer`（absolute + overflow:auto），**不是 window**。
- 内容管道：`src/content/**` markdown（可嵌 raw HTML）→ 构建期 readonly-data + search-index。
- 样式自治：内容/应用样式归属自身文件（如 `src/lib/styles/x-archive.css`，谁渲染谁导入），
  禁止污染全局 app.css。
- 隐私红线：私有仓代码/diff/内部文档/密钥/数据文件绝不进公开渠道；仓名可写（2026-10-05 裁决）。
- 验证方式：`pnpm build`（exit 0）作为编译门禁；禁止全量 svelte-check（性能，2026-10-05 裁决）。

## 相关 skills

- `skills/gaubee-skills/`：工作信号活档案（GitHub/X 信号 → 日报/周报/月报/年报/归档 events），
  规范见其 SKILL.md；数据根 `~/.gaubee-skills/`（绝不进 git）。
