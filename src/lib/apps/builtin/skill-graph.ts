import { leafRoute } from "$lib/router";
/**
 * 技能图谱应用（系统内置，不可卸载）。
 *
 * 功能：Gaubee 的技能 Graph 可视化——星标收藏、项目（个人 + org）、
 * 项目依赖技术、新技术采用时间线，力导向图浏览。
 *
 * 数据：构建期由 gaubee-skills 管道生成并提交进仓库的静态 JSON
 * （static/skill-graph/data.json，public 视图：仅公开仓信号），
 * 运行时按需 fetch，不进 JS bundle。数据维护方是 gaubee-skills
 * 管道（每日 08:30 自动重建），应用本身无编辑能力。
 *
 * 视觉：继承站点毛玻璃主题（oklch 变量 + .dark 双模式）。
 */
import Waypoints from "@lucide/svelte/icons/waypoints";

import type { AppEntry } from "../types";

export const skillGraphApp: AppEntry = {
  manifest: {
    id: "skill-graph",
    name: "技能图谱",
    icon: Waypoints,
    category: "system",
    defaultArea: "main",
    activities: [
      {
        pattern: "/app/skill-graph",
        entry: true,
        root: leafRoute("skill-graph", () => import("$lib/apps/views/SkillGraphView.svelte")),
      },
    ],
    description: "技能与技术的关联地图",
    longDescription:
      "把 GitHub 星标收藏、个人与组织项目、项目中使用的技术依赖画成一张可探索的力导向图：搜索定位、邻域高亮、按类型过滤、回看新技术采用时间线。数据每日由信号管道自动重建（仅公开仓信号）。",
  },
};
