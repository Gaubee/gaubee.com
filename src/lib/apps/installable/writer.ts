/**
 * 写作应用（可选安装，手动安装）。
 *
 * 功能：Markdown 写作总览（文件清单、发表入口）。
 *
 * 编辑闭环（editor/files/changes）已拆为独立的 workflow 应用，
 * writer 通过 deeplink 拉起 workflow 的场景。
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
    activities: [
      {
        route: "/app/writer",
        entry: true,
        view: () => import("$lib/apps/views/WriterView.svelte"),
      },
    ],
    vfsOwnership: [
      "src/content/articles/",
      "src/content/events/",
      "src/content/draft/",
    ],
    cliCommands: [],
  },
};
