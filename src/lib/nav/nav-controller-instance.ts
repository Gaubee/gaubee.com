/**
 * NavController 单例与浏览器侧初始化。
 *
 * 从 controller.ts 拆出来，让 controller.ts 保持纯逻辑（可被 vitest 直接测试，
 * 不触发 `$app/environment` 与 window 副作用）。
 */
import { browser } from "$app/environment";
import {
  NavController,
  setAppRouteResolver,
  setTabRegistry,
  type TabRegistry,
} from "./controller";
import { routeDomainRegistry } from "$lib/apps/route-domain";

export const navController = new NavController();

/** 从 AppManager 构建 TabRegistry 并注入 NavController。 */
export function initNavController(registry: TabRegistry): void {
  setTabRegistry(registry);
  // 注入路由域解析器：让 Dock 图标在应用任意子场景下都正确高亮（聚焦激活）。
  // path → entry route（Dock tabId），由 route-domain 表提供（含应用完整领地）。
  // controller.ts 是纯逻辑不能 import route-domain，故由本桥接层注入闭包。
  setAppRouteResolver((path) => routeDomainRegistry.entryRouteForPath(path));
  if (browser) {
    navController.init();
  }
}
