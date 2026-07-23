/**
 * 工作流应用（默认安装，可卸载）。
 *
 * 从 articles/writer 抽离的「编辑闭环」，自成独立应用：
 *   /app/files → /app/editor/* → /app/changes
 * 文件浏览 → 编辑器（三视图+自动保存）→ 变更暂存 + commit 到 GitHub。
 *
 * 依赖：vfsStore（VFS）、contentStore、gitService（commit）、accountService（鉴权）。
 * articles/writer/github 通过 deeplink 拉起本应用的场景。
 */
import WorkflowIcon from "@lucide/svelte/icons/workflow";
import type { AppEntry } from "../../types";

export const workflowApp: AppEntry = {
  manifest: {
    id: "workflow",
    name: "工作流",
    icon: WorkflowIcon,
    category: "default",
    defaultArea: "main",
    activities: [
      {
        route: "/app/files",
        entry: true,
        view: () => import("$lib/views/FilesView.svelte"),
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
    vfsOwnership: [],
  },
};
