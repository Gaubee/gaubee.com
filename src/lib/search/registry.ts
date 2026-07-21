/**
 * 正交意图：
 * 1. 原始需求（2026-07-21）：搜索由其它应用适配并注册闭包。
 * 2. 保存已安装应用的搜索服务，不依赖任何具体业务应用。
 */
import type { SearchQuery, SearchService } from "./types";

class SearchServiceRegistry {
  private readonly services = new Map<string, SearchService>();

  register(service: SearchService): void {
    this.services.set(service.appId, service);
  }

  unregister(appId: string): void {
    this.services.delete(appId);
  }

  servicesFor(query: SearchQuery): SearchService[] {
    return [...this.services.values()].filter((service) => {
      if (query.excludeAppIds.includes(service.appId)) return false;
      return (
        query.includeAppIds.length === 0 ||
        query.includeAppIds.includes(service.appId)
      );
    });
  }
}

/** 全局搜索服务注册表。 */
export const searchServiceRegistry = new SearchServiceRegistry();
