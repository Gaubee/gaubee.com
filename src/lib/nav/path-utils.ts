/**
 * 路径工具：在给定 tab 列表里找到路径所属的 tab id。
 * 与 controller.ts 的 pathToTabId 类似，但限定在一组 tab 内（供视图层用）。
 * 优先查路由域表（识别应用子场景，如详情页），fallback 到前缀匹配。
 */
import type { TabId } from "./controller";
import {
  matchesRoutePrefix,
  routeDomainRegistry,
} from "$lib/apps/route-domain";

/** 返回 path 所属的 tab id。
 *  优先查路由域表（让应用子场景也能激活其入口 tab）；无匹配则前缀匹配 tabIds。 */
export function pathToTabIdSafe(
  path: string,
  tabIds: readonly TabId[],
): TabId | null {
  const resolved = routeDomainRegistry.entryRouteForPath(path);
  if (resolved && tabIds.includes(resolved)) return resolved;
  for (const tabId of tabIds) {
    if (matchesRoutePrefix(path, tabId)) {
      return tabId;
    }
  }
  return null;
}
