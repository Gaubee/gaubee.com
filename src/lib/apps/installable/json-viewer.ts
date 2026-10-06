import { leafRoute } from "$lib/router";
/**
 * JSON 查看器应用（默认安装，可卸载）。
 *
 * 开发者工具：粘贴/拖入 JSON 即得可折叠的树视图 + 实时校验（错误精确到行列）。
 * 产品原则：高级工程师喜欢用、初级工程师零学习成本（渐进披露——
 * 高级能力一律收纳进带 tooltip 的工具栏入口，默认界面只有「粘贴 → 看树」）。
 */
import FileJson from "@lucide/svelte/icons/file-json";

import type { AppEntry } from "../types";

export const jsonViewerApp: AppEntry = {
  manifest: {
    id: "json-viewer",
    name: "JSON 查看器",
    icon: FileJson,
    category: "default",
    defaultArea: "main",
    activities: [
      {
        pattern: "/app/json-viewer",
        entry: true,
        root: leafRoute("json-viewer", () => import("$lib/apps/views/JsonViewerView.svelte")),
      },
    ],
    vfsOwnership: [],
    description: "粘贴即看的 JSON 树视图与校验工具",
    longDescription:
      "把任意 JSON 粘贴进来，立刻得到可折叠浏览的树视图：类型着色、实时校验（错误精确到行列）、格式化/压缩/复制、大小与深度统计。支持直接拖入 .json 文件。",
    version: "1.0.0",
    author: "Gaubee",
  },
};
