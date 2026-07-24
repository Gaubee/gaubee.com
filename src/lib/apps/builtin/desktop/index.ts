/**
 * 桌面应用（系统级，不可卸载）。
 *
 * GaubeeOS 的默认首页（/desktop）。桌面是常驻背景层：
 * - 应用图标网格（启动器）：已安装应用入口（由 desktopLayout 决定显示/隐藏/排序）。
 * - Widget 瀑布流：各应用声明的内容小组件。
 * - 桌面主菜单（placement:desktop）：仅"管理桌面"入口。
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
    // 桌面主菜单（状态栏桌面态"桌面"下拉，仅"管理桌面"）
    appMenus: [
      {
        id: "desktop:main",
        title: "桌面",
        placement: "desktop",
        order: 0,
        items: [
          {
            id: "launchpad",
            title: "管理桌面",
            icon: LayoutGrid,
            onClick: () =>
              import("$lib/apps/desktop-layout.svelte").then((m) =>
                m.desktopLayout.openLaunchpad(),
              ),
          },
        ],
      },
    ],
  },
};
