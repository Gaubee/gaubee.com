/**
 * GaubeeOS 前端 OS 入口：应用服务总线。
 *
 * 这是 GaubeeOS 对外暴露的统一能力获取入口：
 *   const account = await gaubeeos.getAppService('account')
 *   const git = await gaubeeos.requestAppService('git')
 *
 * 设计：
 * - getAppService(id)：同步返回已注册（已安装且已构造）的 service，未命中返回 null。
 * - requestAppService(id)：异步，按需启动目标应用（触发其 view 加载），再返回 service。
 *   未安装抛 AppServiceNotInstalled；调用方可 catch 引导用户安装。
 *
 * 类型安全：ServiceTypeMap 是 serviceId → 接口类型 的全局映射，
 * 在此集中声明，编译期保证 getAppService 返回正确类型。
 *
 * 循环依赖规避：
 * - 此文件用 `import type` 引用各 service 接口（类型擦除，无运行时依赖）。
 * - 各 service 实现内部不反向 import bus.ts（运行时）；需要类型时用 `import type`。
 */
import { appServiceRegistry, AppServiceNotInstalled } from "./registry";
import { appManager } from "$lib/apps/AppManager.svelte";
import type { AppService } from "./types";

// ---- service 接口类型注册（import type：仅类型，不产生运行时依赖）----
import type { AccountService } from "$lib/apps/builtin/account/service";
import type { GitService } from "$lib/apps/installable/github/service";
import type { NotificationService } from "$lib/apps/builtin/notifications/service.svelte";

/**
 * 全局 service id → 接口类型映射。
 * 新增 service 时在此声明，即可获得 getAppService / requestAppService 的类型提示。
 */
export interface ServiceTypeMap {
  account: AccountService;
  git: GitService;
  notification: NotificationService;
}

/** 所有已注册的 service id。 */
export type ServiceId = keyof ServiceTypeMap;

/**
 * account service 未认证时抛出。
 * 调用方 catch 后引导用户到 /app/account 登录。
 */
export class NotAuthenticatedError extends Error {
  constructor(message = "当前操作需要登录账户") {
    super(message);
    this.name = "NotAuthenticatedError";
  }
}

/**
 * 提交时没有待提交变更（VFS dirty 为空）。
 * 由 GitService.commit 抛出，调用方据此提示「没有待发表的变更」。
 */
export class NoChangesError extends Error {
  constructor(message = "没有待提交的变更") {
    super(message);
    this.name = "NoChangesError";
  }
}

/** gaubeeos 前端 OS 对象。 */
export const gaubeeos = {
  /**
   * 同步获取已注册的 service。
   * @returns service 实例；未注册（应用未安装/未加载）返回 null。
   */
  getAppService<K extends ServiceId>(id: K): ServiceTypeMap[K] | null {
    return appServiceRegistry.get<ServiceTypeMap[K]>(id);
  },

  /**
   * 检查某 service 是否可用（对应应用已安装）。
   */
  hasService(id: ServiceId): boolean {
    return appServiceRegistry.has(id);
  },

  /**
   * 异步按需获取 service：必要时启动提供该 service 的应用。
   *
   * 流程：
   * 1. 若 service 已注册（应用已安装）→ 直接 request 返回（触发懒构造）。
   * 2. 否则抛 AppServiceNotInstalled（应用未安装，调用方引导安装）。
   *
   * 「按需启动应用」语义：保证 service 对应应用已安装，并触发 service 工厂懒构造。
   * 不主动加载应用 view（account/git 等现有 service 工厂自包含，不依赖 view）；
   * 若未来某 service 工厂依赖 view 副作用，应在工厂闭包内自行 await loadView。
   *
   * @throws AppServiceNotInstalled 提供该 service 的应用未安装。
   */
  async requestAppService<K extends ServiceId>(
    id: K,
  ): Promise<ServiceTypeMap[K]> {
    const appId = appServiceRegistry.appIdOf(id);
    if (!appId) throw new AppServiceNotInstalled(id);

    // 确保应用已安装（default/system 应用通常已装；installable 可能未装）
    if (!appManager.isInstalled(appId)) {
      throw new AppServiceNotInstalled(id);
    }

    // 触发 service 工厂懒构造（工厂内部按需完成初始化）
    return appServiceRegistry.request<ServiceTypeMap[K]>(id);
  },
};

export { AppServiceNotInstalled } from "./registry";
export type { AppService } from "./types";
