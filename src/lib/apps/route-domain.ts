/**
 * 路由域表：把「应用完整领地」投影为 path → entry route 的查询结构。
 *
 * 解决「tabId=route 当身份」的两大缺陷：
 * 1. 聚焦激活失效：应用拥有多个场景（如 articles 的 /article/* 详情），
 *    旧前缀匹配只认 entry route，落到子场景时 Dock 图标高亮丢失。
 * 2. 切换重置入口：无 per-app 身份，无法记忆。
 *
 * 本表只解决第 1 点（按 path 反查归属应用的 Dock 身份 = entry route）；
 * per-app 场景记忆由 NavController 的 appScenes 承担（见 controller.ts）。
 *
 * 投影来源：所有已注册应用的 manifest.activities（每个 activity 的 route 前缀）。
 * deepLinks 不纳入归属判定（它是对外拉起契约，归属仍指向实际渲染的应用）。
 */
import type { AppManifest } from "./types";
import { getEntryRoute } from "./types";

/** 路由前缀匹配谓词：path 命中 prefix（相等或以 prefix + '/' 开头）。
 *  统一「path 属于某路由域」的判定逻辑，消除散落各处的前缀匹配重复。 */
export function matchesRoutePrefix(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(prefix + "/");
}

export interface RouteDomainEntry {
  appId: string;
  /** 该应用的 entry route（Dock 身份/tabId）。 */
  entryRoute: string;
  /** 匹配此 path 的 activity route 前缀。 */
  route: string;
}

/** 路由域注册表单例。AppManager 在 register 时投影全部应用的 activities。 */
class RouteDomainRegistry {
  /** 按 activity route 前缀 → { appId, entryRoute, route }。
   *  注册顺序即匹配优先级（先注册先匹配），但实际用最长前缀匹配消歧。 */
  private readonly domains = new Map<string, RouteDomainEntry>();

  /** 注册一个应用的所有 activity 路由域。 */
  registerApp(manifest: AppManifest): void {
    const entryRoute = getEntryRoute(manifest);
    for (const activity of manifest.activities) {
      this.domains.set(activity.route, {
        appId: manifest.id,
        entryRoute,
        route: activity.route,
      });
    }
  }

  /** 注销一个应用的全部路由域。 */
  unregisterApp(appId: string): void {
    for (const [route, entry] of this.domains) {
      if (entry.appId === appId) this.domains.delete(route);
    }
  }

  /** 给定路径，返回归属应用的 entry route（Dock tabId，最长前缀优先）。
   *  例：/article/0001/foo → 匹配 /article（articles）→ /app/articles。 */
  entryRouteForPath(path: string): string | null {
    return this.domainForPath(path)?.entryRoute ?? null;
  }

  /** 给定路径，返回归属应用 id（最长前缀优先）。 */
  appIdForPath(path: string): string | null {
    return this.domainForPath(path)?.appId ?? null;
  }

  /** 给定路径，返回归属的路由域条目（最长前缀优先）。 */
  domainForPath(path: string): RouteDomainEntry | null {
    let best: RouteDomainEntry | null = null;
    for (const entry of this.domains.values()) {
      if (matchesRoutePrefix(path, entry.route)) {
        if (!best || entry.route.length > best.route.length) {
          best = entry;
        }
      }
    }
    return best;
  }

  /** 是否存在某 route 前缀（用于校验）。 */
  hasRoute(route: string): boolean {
    return this.domains.has(route);
  }

  /** 清空（测试用）。 */
  clear(): void {
    this.domains.clear();
  }
}

/** 全局路由域注册表单例。 */
export const routeDomainRegistry = new RouteDomainRegistry();
