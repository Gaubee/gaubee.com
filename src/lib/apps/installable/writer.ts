/**
 * 写作应用（可选安装，手动安装）。
 *
 * 功能：Markdown 编辑器、文件管理、变更提交、归档。
 * 提供 CLI 命令：write
 */
import FileText from "@lucide/svelte/icons/file-text";
import type { AppEntry } from "../types";

export const writerApp: AppEntry = {
  manifest: {
    id: "writer",
    name: "写作",
    icon: FileText,
    category: "installable",
    defaultArea: "main",
    route: "/app/writer",
    vfsOwnership: ["src/content/articles/", "src/content/events/", "src/content/draft/"],
    cliCommands: [],
  },
  view: () => import("$lib/views/EditorView.svelte"),
};
