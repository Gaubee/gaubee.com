/**
 * 文件管理应用（默认安装，可卸载）。
 *
 * content 目录的 CRUD/组织入口：
 * - /app/files（entry）：浏览 articles/events/draft，新建（序号命名），最近文章。
 * 拥有 src/content/{articles,events,draft} 目录（vfsOwnership）。
 *
 * 点文件跳转 /app/editor 进入「写作」应用的编辑器（跨应用协作）。
 */
import Folder from "@lucide/svelte/icons/folder";
import type { AppEntry } from "../types";

export const filesApp: AppEntry = {
  manifest: {
    id: "files",
    name: "文件管理",
    icon: Folder,
    category: "default",
    defaultArea: "main",
    activities: [
      {
        route: "/app/files",
        entry: true,
        view: () => import("$lib/views/FilesView.svelte"),
      },
    ],
    vfsOwnership: [
      "src/content/articles/",
      "src/content/events/",
      "src/content/draft/",
    ],
  },
};
