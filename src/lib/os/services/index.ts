/**
 * GaubeeOS 应用服务总线统一导出。
 *
 * 调用方使用：
 *   import { gaubeeos, AppServiceNotInstalled, NotAuthenticatedError } from "$lib/os/services";
 *   import type { AppService, ServiceId, ServiceTypeMap } from "$lib/os/services";
 *
 * 应用声明 service（在 manifest）：
 *   import type { ServiceDeclaration } from "$lib/os/services";
 */
export { gaubeeos } from "./bus";
export { NotAuthenticatedError, NoChangesError } from "./bus";
export { appServiceRegistry } from "./registry";
export { AppServiceNotInstalled } from "./registry";

export type {
  AppService,
  AppServiceFactory,
  ServiceDeclaration,
} from "./types";
export type { ServiceId, ServiceTypeMap } from "./bus";
