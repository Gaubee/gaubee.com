/**
 * GaubeeOS 应用服务注册表。
 *
 * 职责：
 * 1. 保存「已安装应用」声明的 service 工厂（serviceId → { appId, factory }）。
 * 2. 不依赖任何具体业务应用（正交于 account/git 等）。
 *
 * 生命周期由 AppManager 驱动：
 * - install / init 时调 register(appId, services)
 * - uninstall 时调 unregisterApp(appId)
 *
 * 注意：registry 只保存「已安装应用」的 service。未安装应用的 service
 * 不在 registry 中，调用方会得到 null / AppServiceNotInstalled。
 */
import type {
  AppService,
  AppServiceFactory,
  ServiceDeclaration,
} from "./types";

/** registry 内部条目。 */
interface RegistryEntry {
  readonly appId: string;
  readonly factory: AppServiceFactory;
}

/** 已构造的 service 实例缓存（serviceId → 实例）。 */
interface ResolvedEntry {
  readonly appId: string;
  readonly service: AppService;
}

/**
 * service 未安装/不可用时抛出。
 * 调用方可 catch 后引导用户安装对应应用。
 */
export class AppServiceNotInstalled extends Error {
  readonly serviceId: string;
  constructor(serviceId: string) {
    super(`应用服务 "${serviceId}" 不可用（提供该服务的应用未安装）`);
    this.name = "AppServiceNotInstalled";
    this.serviceId = serviceId;
  }
}

class AppServiceRegistry {
  /** serviceId → 声明条目（工厂）。 */
  private readonly declarations = new Map<string, RegistryEntry>();

  /** serviceId → 已构造实例（懒缓存）。 */
  private readonly resolved = new Map<string, ResolvedEntry>();

  /**
   * 注册一个应用声明的全部 service。
   * 重复注册同一 serviceId 会被覆盖（用于应用重装场景）。
   */
  register(appId: string, services: ServiceDeclaration): void {
    for (const [serviceId, factory] of Object.entries(services)) {
      this.declarations.set(serviceId, { appId, factory });
    }
  }

  /** 卸载应用时清理：移除该应用声明的 service 声明与已构造实例。 */
  unregisterApp(appId: string): void {
    for (const [serviceId, entry] of this.declarations) {
      if (entry.appId === appId) {
        this.declarations.delete(serviceId);
        this.resolved.delete(serviceId);
      }
    }
  }

  /** 某个 service 是否可用（应用已安装且已声明）。 */
  has(serviceId: string): boolean {
    return this.declarations.has(serviceId);
  }

  /** 反查：serviceId → 提供它的 appId（用于按需启动应用）。 */
  appIdOf(serviceId: string): string | undefined {
    return this.declarations.get(serviceId)?.appId;
  }

  /**
   * 同步获取 service（已构造则直接返回缓存）。
   * 未注册返回 null（不抛错，便于条件渲染）。
   */
  get<T extends AppService>(serviceId: string): T | null {
    const resolved = this.resolved.get(serviceId);
    if (resolved) return resolved.service as T;

    const entry = this.declarations.get(serviceId);
    if (!entry) return null;

    // 工厂可能是同步的，尝试同步构造并缓存
    const result = entry.factory();
    if (result instanceof Promise) {
      // 异步工厂无法同步返回；调用方应改用 request()
      return null;
    }
    this.resolved.set(serviceId, { appId: entry.appId, service: result });
    return result as T;
  }

  /**
   * 异步获取 service（支持异步工厂；未注册抛 AppServiceNotInstalled）。
   * 不负责启动应用（由 bus 层在调用前确保应用已加载）。
   */
  async request<T extends AppService>(serviceId: string): Promise<T> {
    const resolved = this.resolved.get(serviceId);
    if (resolved) return resolved.service as T;

    const entry = this.declarations.get(serviceId);
    if (!entry) throw new AppServiceNotInstalled(serviceId);

    const service = await entry.factory();
    this.resolved.set(serviceId, { appId: entry.appId, service });
    return service as T;
  }

  /** 清空全部（仅测试/重置用）。 */
  clear(): void {
    this.declarations.clear();
    this.resolved.clear();
  }
}

/** 全局服务注册表单例。 */
export const appServiceRegistry = new AppServiceRegistry();
