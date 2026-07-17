/**
 * 路径工具：在给定 tab 列表里找到路径所属的 tab id。
 * 与 controller.ts 的 pathToTabId 类似，但限定在一组 tab 内（供视图层用）。
 */
import type { TabId } from "./controller";

/** 返回 path 所属的 tab id（path === tab 或 path 以 tab + '/' 开头），无则 null。 */
export function pathToTabIdSafe(
  path: string,
  tabIds: readonly TabId[],
): TabId | null {
  for (const tabId of tabIds) {
    if (path === tabId || path.startsWith(tabId + "/")) {
      return tabId;
    }
  }
  return null;
}
