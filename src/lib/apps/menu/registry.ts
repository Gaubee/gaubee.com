/**
 * 应用菜单注册表（单例）。
 *
 * 仿 settingsSections/widget registry 范式：
 * AppManager 在 install/init 时把 manifest.appMenus 投影进来，
 * SystemStatusBar 遍历 forPlacement(placement) 渲染。
 */
import type { AppMenuDeclaration, MenuPlacement } from "./types";

class AppMenuRegistry {
  private readonly menus = new Map<string, AppMenuDeclaration>();

  register(menu: AppMenuDeclaration): void {
    this.menus.set(menu.id, menu);
  }

  unregister(id: string): void {
    this.menus.delete(id);
  }

  /** 全部菜单，按 order（升序）→ 注册顺序稳定排序。 */
  all(): AppMenuDeclaration[] {
    return this.sortMenus([...this.menus.values()]);
  }

  /** 按位置过滤。
   *  - system/tray：返回该 placement 全部菜单。
   *  - app：仅返回 appId 匹配 activeAppId 的菜单（当前激活应用专属）。 */
  forPlacement(
    placement: MenuPlacement,
    activeAppId?: string,
  ): AppMenuDeclaration[] {
    return this.sortMenus(
      [...this.menus.values()].filter((m) => {
        if (m.placement !== placement) return false;
        if (placement === "app") {
          // app 菜单仅当声明 appId 且匹配当前激活应用时显示
          return !m.appId || m.appId === activeAppId;
        }
        return true;
      }),
    );
  }

  private sortMenus(menus: AppMenuDeclaration[]): AppMenuDeclaration[] {
    return menus.sort((a, b) => {
      const oa = a.order ?? Number.MAX_SAFE_INTEGER;
      const ob = b.order ?? Number.MAX_SAFE_INTEGER;
      return oa - ob;
    });
  }
}

export const appMenuRegistry = new AppMenuRegistry();
