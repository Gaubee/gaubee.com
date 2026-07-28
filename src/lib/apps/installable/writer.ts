import { leafRoute } from "$lib/router";
/**
 * 写作应用（可选安装，手动安装）。
 *
 * 完整「创作 → 发表」流水线，三场景共享 git.commit + handlePublishError + vfsStore/contentQuery：
 * - /app/writer（entry）：总览（文件清单 + 批量发表入口）。
 * - /app/editor：编辑器（三视图 + 自动保存 + 单篇发表）。
 * - /app/changes：变更（diff 预览 + 撤销 + 手动 commit，发表兜底）。
 *
 * 文件实体的 CRUD/组织（新建/命名）归「文件管理」应用（拥有 content 目录）；
 * 写作应用专注内容创作与发表。
 */
import FileText from "@lucide/svelte/icons/file-text";
import { z } from "zod";

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
        pattern: "/app/writer",
        entry: true,
        root: leafRoute("writer", () => import("$lib/apps/views/WriterView.svelte")),
      },
      {
        // 内容管线编辑（collection/stem 走 search query，避免多段 stem 撑爆 index route 段匹配）
        pattern: "/app/editor",
        root: leafRoute(
          "writer.editor",
          () => import("$lib/views/EditorView.svelte"),
          z.object({
            collection: z.enum(["articles", "events", "draft"]),
            stem: z.string().min(1),
          }),
        ),
      },
      {
        pattern: "/app/changes",
        root: leafRoute("writer.changes", () => import("$lib/views/ChangesView.svelte")),
      },
    ],
    cliCommands: [],
    description: "Markdown 写作与发表",
    longDescription:
      "完整的创作→发表流水线。编辑器支持三视图（编辑/分屏/预览）、自动保存和单篇/批量发表到 GitHub。",
    version: "1.0.0",
    author: "Gaubee",
  },
};
