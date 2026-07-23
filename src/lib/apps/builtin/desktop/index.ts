/**
 * 桌面应用（系统级，不可卸载）。
 *
 * GaubeeOS 的默认首页（/desktop）。桌面是常驻背景层：
 * - 应用图标网格（启动器）：已安装应用入口。
 * - Widget 瀑布流：各应用声明的内容小组件（最近文章/说说/标签云等）。
 * - 任务栏（Dock）：已打开应用 + 常驻图标 + pop 入口。
 *
 * 应用以浮层形式覆盖在桌面之上（打开应用时桌面作背景层常驻）。
 * 任务栏属桌面视觉体系，随桌面常驻可见。
 */
import LayoutGrid from "@lucide/svelte/icons/layout-grid";
import type { AppEntry } from "../../types";

export const desktopApp: AppEntry = {
  manifest: {
    id: "desktop",
    name: "桌面",
    icon: LayoutGrid,
    category: "system",
    defaultArea: "main",
    activities: [
      {
        route: "/desktop",
        entry: true,
        view: () => import("$lib/apps/views/DesktopView.svelte"),
      },
    ],
    // 桌面是 shell 级背景层（AreaOutlet 直接渲染，不经 tab 机制），
    // 从主导航隐藏——不进 mainTabs/任务栏，由任务栏专属"桌面入口"提供回桌面。
    hiddenFromNav: true,
  },
};
