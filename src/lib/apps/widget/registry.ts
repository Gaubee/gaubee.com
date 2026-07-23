/**
 * Widget 注册表（单例）。
 *
 * 仿 settingsSectionsRegistry 模式：AppManager 在 install/init 时把
 * manifest.widgets 投影进来，DesktopView 遍历 all() 渲染瀑布流。
 */
import type { WidgetDeclaration } from "./types";

class WidgetRegistry {
  private readonly widgets = new Map<string, WidgetDeclaration>();

  register(widget: WidgetDeclaration): void {
    this.widgets.set(widget.id, widget);
  }

  unregister(id: string): void {
    this.widgets.delete(id);
  }

  /** 全部 widget，按 order（升序）→ 注册顺序稳定排序。 */
  all(): WidgetDeclaration[] {
    return [...this.widgets.values()].sort((a, b) => {
      const oa = a.order ?? Number.MAX_SAFE_INTEGER;
      const ob = b.order ?? Number.MAX_SAFE_INTEGER;
      return oa - ob;
    });
  }
}

export const widgetRegistry = new WidgetRegistry();
