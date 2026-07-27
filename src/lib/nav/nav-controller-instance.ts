/**
 * NavController 单例与浏览器侧初始化。
 *
 * 从 controller.ts 拆出来，让 controller.ts 保持纯逻辑（可被 vitest 直接测试，
 * 不触发 `$app/environment` 与 window 副作用）。
 *
 * 2026-07-27 路由重构：同时注入 NavControllerAdapter 到 $lib/router/navigate，
 * 让 nav.go / nav.goById 等类型安全 API 能委托 NavController 执行导航。
 */
import { browser } from "$app/environment";
import { pushState, replaceState } from "$app/navigation";
import { routeDomainRegistry } from "$lib/apps/route-domain";
import { setNavControllerAdapter } from "$lib/router/navigate";

import {
  NavController,
  setAppRouteResolver,
  setHistoryAdapter,
  setTabRegistry,
  type TabRegistry,
} from "./controller";

export const navController = new NavController();

/** 从 AppManager 构建 TabRegistry 并注入 NavController。 */
export function initNavController(registry: TabRegistry): void {
  setTabRegistry(registry);
  // 注入路由域解析器：让 Dock 图标在应用任意子场景下都正确高亮（聚焦激活）。
  // path → entry route（Dock tabId），由 route-domain 表提供（含应用完整领地）。
  // controller.ts 是纯逻辑不能 import route-domain，故由本桥接层注入闭包。
  setAppRouteResolver((path) => routeDomainRegistry.entryRouteForPath(path));
  // 注入 SvelteKit history 适配器：用 $app/navigation 的 pushState/replaceState
  // 替代 window.history.*，避免与 SvelteKit router 冲突（消除 pushState 警告）。
  setHistoryAdapter({
    push: (url, state) => pushState(url, state),
    replace: (url, state) => replaceState(url, state),
  });
  // 注入 NavController 适配器：让 $lib/router 的类型安全 API（go/goById）委托本实例。
  setNavControllerAdapter({
    navigateMain: (path, action) => navController.navigateMain(path, action),
    focusApp: (tabId) => navController.focusApp(tabId),
    openApp: (tabId) => navController.openApp(tabId),
    activatePop: (path) => navController.activatePop(path),
    deactivatePop: () => navController.deactivatePop(),
  });
  if (browser) {
    navController.init();
  }
}
