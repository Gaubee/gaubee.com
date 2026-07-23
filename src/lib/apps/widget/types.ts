/**
 * Widget（桌面小组件）类型定义。
 *
 * 心智模型（iPadOS）：应用可在桌面注册小组件，做简化内容展示。
 * 声明式扩展点：AppManifest.widgets → AppManager 投影到 widgetRegistry → DesktopView 拉取渲染。
 * 谁提供数据谁注册 widget，桌面应用不反向依赖具体业务应用（与 settingsSections 同范式）。
 */
import type { Component } from "svelte";

/** Widget 尺寸档位（瀑布流占列数，容器查询自适应）。 */
export type WidgetSize = "small" | "medium" | "wide";

/** Widget 声明（由 manifest.widgets 注册）。 */
export interface WidgetDeclaration {
  /** 唯一标识（如 'recent-articles'）。 */
  id: string;
  /** 标题。 */
  title: string;
  /** Widget 渲染组件（自适应卡片，内部用容器查询适配）。 */
  render: Component;
  /** 默认尺寸（占列数）。small=1 列，medium=2 列，wide=全宽。默认 small。 */
  size?: WidgetSize;
  /** 渲染顺序，越小越靠前。 */
  order?: number;
}
