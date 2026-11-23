import { defineRoute } from "$lib/router";
import { z } from "zod";
/**
 * 工具集应用（默认安装，可卸载）。
 *
 * 功能：gaubee-skills 工坊产出的可公开使用工具。数据全部来自 `/static/tools/` 下的
 * 公开投影，纯前端计算，不发服务端请求。
 *
 * 两类形态（见 openspec/changes/tool-body-economy）：
 *   - webapp：能直接在浏览器里跑（星标检索、时间线、依赖溯源…）
 *   - self-hosted：需要私有数据/凭据/本地媒体，详情页只给部署说明与仓库名
 *
 * 路由：
 *   /app/tools（entry）→ 列表（按形态分组）
 *   /app/tools/:toolId → 详情（webapp 给界面，self-hosted 给部署段落）
 */
import Wrench from "@lucide/svelte/icons/wrench";

import type { AppEntry } from "../types";

export const toolsApp: AppEntry = {
  manifest: {
    id: "tools",
    name: "工具集",
    icon: Wrench,
    category: "default",
    defaultArea: "main",
    activities: [
      {
        pattern: "/app/tools",
        entry: true,
        root: defineRoute({
          id: "tools",
          pattern: "",
          component: () => import("$lib/apps/views/tools/ToolsListView.svelte"),
          children: [
            defineRoute({
              id: "tools.detail",
              pattern: ":toolId",
              params: z.object({ toolId: z.string().min(1) }),
              component: () => import("$lib/apps/views/tools/ToolDetailView.svelte"),
            }),
          ],
        }),
      },
    ],
    vfsOwnership: [],
    description: "工坊产出的可公开工具",
    longDescription:
      "gaubee-skills 工坊的工具集：能部署的直接在这里跑（纯前端，数据是公开投影）；" +
      "需要本地环境或私有数据的，给自托管部署说明。",
    version: "0.1.0",
    author: "Gaubee",
  },
};
