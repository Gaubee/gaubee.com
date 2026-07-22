/**
 * GaubeeOS 应用服务总线：类型契约。
 *
 * 核心理念：应用能力以命名 service 形式暴露。
 * - 函数是一等公民：service 是一组方法的内存对象，不做抽象 RPC 协议。
 * - 应用通过 manifest.services 声明自己提供的 service 工厂。
 * - 调用方通过 gaubeeos.getAppService(id) / requestAppService(id) 获取，
 *   按需启动目标应用并将请求路由到 service。
 *
 * 这是现有 searchService 扩展点的自然泛化：
 * 从「单一搜索能力」升级为「任意命名 service」。
 */

/** 一个应用暴露的命名 service 的基契约。 */
export interface AppService {
  /** service 标识（全局唯一，如 'account'、'git'）。 */
  readonly id: string;
  /** 提供该 service 的应用 id（如 'account'、'github'）。 */
  readonly appId: string;
}

/**
 * manifest 声明的 service 工厂：应用按需启动时调用，返回 service 实例。
 * 工厂语义保证「懒构造」——只有真正被请求时才实例化 service。
 */
export type AppServiceFactory<T extends AppService = AppService> = () =>
  T | Promise<T>;

/**
 * manifest.services 的声明项：service id → 工厂闭包。
 * 一个应用可同时声明多个 service。
 */
export type ServiceDeclaration = Record<string, AppServiceFactory>;
