/**
 * 写作应用（可选安装，手动安装）。
 *
 * 完整「创作 → 发表」流水线，三场景共享 git.commit + handlePublishError + contentStore：
 * - /app/writer（entry）：总览（文件清单 + 批量发表入口）。
 * - /app/editor：编辑器（三视图 + 自动保存 + 单篇发表）。
 * - /app/changes：变更（diff 预览 + 撤销 + 手动 commit，发表兜底）。
 *
 * 文件实体的 CRUD/组织（新建/命名）归「文件管理」应用（拥有 content 目录）；
 * 写作应用专注内容创作与发表。
 */
import FileText from "@lucide/svelte/icons/file-text";
import type { AppEntry } from "../types";

export const writerApp: AppEntry = {
  manifest: {
    id: "writer",
    name: "写作",
    icon: FileText,
    // 编辑器/变更是文件管理高频跳转的协作场景，默认安装可用。
    category: "default",
    defaultArea: "main",
    activities: [
      {
        route: "/app/writer",
        entry: true,
        view: () => import("$lib/apps/views/WriterView.svelte"),
      },
      {
        route: "/app/editor",
        view: () => import("$lib/views/EditorView.svelte"),
      },
      {
        route: "/app/changes",
        view: () => import("$lib/views/ChangesView.svelte"),
      },
    ],
    cliCommands: [],
  },
};
